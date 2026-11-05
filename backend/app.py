"""SongToSheet V1 API + static website.

Run `uvicorn app:app --reload` from this folder. Local MVP storage is SQLite;
production requires an external database, object storage and dedicated workers.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import subprocess
import tempfile
import threading
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Cookie, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from transcriber import get_duration, process_file

ROOT=Path(__file__).resolve().parent
load_dotenv(ROOT/'.env')
DATA=Path(os.getenv('DATA_DIR',str(ROOT/'data'))).resolve()
DATA.mkdir(parents=True,exist_ok=True)
DB=DATA/'songtosheet.db'
EXPORTS=DATA/'exports'; EXPORTS.mkdir(exist_ok=True)
UPLOADS=DATA/'uploads'; UPLOADS.mkdir(exist_ok=True)
BASE_URL=os.getenv('PUBLIC_BASE_URL','http://localhost:8000').rstrip('/')
SECRET=os.getenv('SESSION_SECRET') or secrets.token_urlsafe(48)
DEV=os.getenv('DEV_MODE','1')=='1'
STRIPE_KEY=os.getenv('STRIPE_SECRET_KEY','')
STRIPE_WEBHOOK=os.getenv('STRIPE_WEBHOOK_SECRET','')
# Prices are initial positioning hypotheses, not a profitability guarantee.
PACKS={
    'starter':{'name':'Découverte','credits':10,'cents':900,'badge':'Pour commencer'},
    'standard':{'name':'Musicien','credits':30,'cents':1900,'badge':'Le plus populaire'},
    'studio':{'name':'Studio','credits':80,'cents':3900,'badge':'Meilleur prix / crédit'},
}
app=FastAPI(title='SongToSheet',version='0.1.0',docs_url='/api/docs' if DEV else None)
app.mount('/static',StaticFiles(directory=str(ROOT/'web')),name='static')


def db():
    con=sqlite3.connect(DB,timeout=30)
    con.row_factory=sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    con.execute('PRAGMA busy_timeout=30000')
    return con


def init_db():
    with db() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
            credits INTEGER NOT NULL DEFAULT 0 CHECK(credits>=0), created_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
            instrument TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '',
            duration REAL NOT NULL, reserved_credits INTEGER NOT NULL,
            status TEXT NOT NULL, note_count INTEGER NOT NULL DEFAULT 0,
            bpm INTEGER, notes_json TEXT, error_message TEXT,
            created_at INTEGER NOT NULL, finished_at INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id)
          );
          CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs(user_id,created_at DESC);
          CREATE TABLE IF NOT EXISTS credit_events (
            event_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, delta INTEGER NOT NULL,
            source TEXT NOT NULL, created_at INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
          );
        ''')
init_db()


def fail(message:str,status:int=400):
    raise HTTPException(status_code=status,detail=message)


def pwd_hash(password:str,salt:str|None=None):
    salt=salt or secrets.token_hex(16)
    digest=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),260000)
    return f'{salt}:{digest.hex()}'


def pwd_check(password,stored):
    try:
        salt,expected=stored.split(':',1)
        return hmac.compare_digest(pwd_hash(password,salt),stored)
    except Exception:
        return False


def session_token(uid:str):
    expires=str(int(time.time())+14*86400)
    nonce=secrets.token_urlsafe(18)
    payload=f'{uid}.{expires}.{nonce}'
    sig=hmac.new(SECRET.encode(),payload.encode(),'sha256').hexdigest()
    return f'{payload}.{sig}'


def session_user(request:Request):
    token=request.cookies.get('sts_session','')
    try:
        uid,expires,nonce,sig=token.split('.')
        payload=f'{uid}.{expires}.{nonce}'
        expected=hmac.new(SECRET.encode(),payload.encode(),'sha256').hexdigest()
        if time.time()>int(expires) or not hmac.compare_digest(sig,expected): return None
    except Exception: return None
    with db() as c:
        row=c.execute('SELECT id,email,credits,created_at FROM users WHERE id=?',(uid,)).fetchone()
        return dict(row) if row else None


def auth(request:Request):
    u=session_user(request)
    if not u: fail('Connectez-vous pour continuer.',401)
    return u


def check_origin(request:Request):
    origin=request.headers.get('origin')
    # Ensure the browser POST is from this same site (cookie auth + SameSite).
    if origin:
        try:
            parsed=urlparse(origin)
            host=request.headers.get('host','')
            if parsed.netloc!=host:
                fail('Origine de la requête refusée.',403)
        except ValueError: fail('Origine invalide.',403)


_ATTEMPTS=defaultdict(deque)
_ATTEMPT_LOCK=threading.Lock()
def rate_limit(request:Request,kind:str,max_hits:int=12,seconds:int=60):
    # Local process throttle only; use shared rate limiting in production.
    ip=request.client.host if request.client else 'unknown'
    key=(ip,kind)
    with _ATTEMPT_LOCK:
        q=_ATTEMPTS[key]; now=time.monotonic()
        while q and q[0]<now-seconds:q.popleft()
        if len(q)>=max_hits: fail('Trop de tentatives. Réessayez dans un instant.',429)
        q.append(now)


class Credentials(BaseModel):
    email:str=Field(min_length=5,max_length=240)
    password:str=Field(min_length=8,max_length=128)

class LinkInput(BaseModel):
    url:str=Field(min_length=10,max_length=2048)

class CheckoutInput(BaseModel):
    pack_id:str


@app.middleware('http')
async def secure_headers(request:Request,call_next):
    response=await call_next(request)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Referrer-Policy']='strict-origin-when-cross-origin'
    response.headers['X-Frame-Options']='DENY'
    response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com"
    return response


@app.get('/api/health')
def health():return {'ok':True,'version':'0.1.0','transcription':'experimental-melody'}


@app.get('/api/packs')
def packs():
    return {'packs':[{'id':k,**v,'euros':v['cents']/100} for k,v in PACKS.items()], 'checkout_enabled':bool(STRIPE_KEY and STRIPE_WEBHOOK)}


@app.get('/api/auth/me')
def me(request:Request):
    return {'user':session_user(request)}


@app.post('/api/auth/signup')
def signup(request:Request,body:Credentials,response:Response):
    check_origin(request);rate_limit(request,'signup',6,900)
    email=body.email.strip().lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]{2,}',email):fail('Adresse email invalide')
    uid=uuid.uuid4().hex
    with db() as c:
        try:
            c.execute('INSERT INTO users VALUES(?,?,?,?,?)',(uid,email,pwd_hash(body.password),0,int(time.time())))
        except sqlite3.IntegrityError: fail('Un compte utilise déjà cet email.',409)
    response.set_cookie('sts_session',session_token(uid),max_age=14*86400,httponly=True,
                        secure=not DEV,samesite='lax',path='/')
    return {'user':{'id':uid,'email':email,'credits':0},'message':'Compte créé. Aucun crédit gratuit ajouté.'}


@app.post('/api/auth/login')
def login(request:Request,body:Credentials,response:Response):
    check_origin(request);rate_limit(request,'login',10,900)
    email=body.email.strip().lower()
    with db() as c:
        row=c.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()
    if not row or not pwd_check(body.password,row['password_hash']):fail('Email ou mot de passe incorrect.',401)
    response.set_cookie('sts_session',session_token(row['id']),max_age=14*86400,httponly=True,
                        secure=not DEV,samesite='lax',path='/')
    return {'user':{'id':row['id'],'email':email,'credits':row['credits']}}


@app.post('/api/auth/logout')
def logout(request:Request,response:Response):
    check_origin(request)
    response.delete_cookie('sts_session',path='/')
    return {'ok':True}


@app.post('/api/links/inspect')
def inspect_link(request:Request,body:LinkInput):
    check_origin(request);rate_limit(request,'link',40,900)
    value=body.url.strip()
    try:
        p=urlparse(value)
        if p.scheme!='https' or p.username or p.password:raise ValueError()
        host=(p.hostname or '').lower().rstrip('.')
    except Exception:fail('Utilisez un lien HTTPS YouTube ou Spotify valide.')
    if host in ['youtu.be','youtube.com','www.youtube.com','m.youtube.com','music.youtube.com']:
        provider='YouTube'
    elif host in ['open.spotify.com','spotify.com']:
        provider='Spotify'
    elif host in ['soundcloud.com','www.soundcloud.com']:
        provider='SoundCloud'
    else:fail('Lien non pris en charge pour le moment. Importez directement un fichier MP3 ou WAV.')
    if not p.path or p.path=='/':fail('Ce lien ne désigne pas un morceau.')
    return {'provider':provider,'source_url':value,'requires_audio':True,
            'message':f'Lien {provider} reconnu ! Pour la transcription, importez un fichier audio que vous avez le droit d’utiliser. Nous ne téléchargeons pas le son depuis {provider}.'}


@app.get('/api/jobs')
def jobs(request:Request):
    u=auth(request)
    with db() as c:
        rows=c.execute('SELECT id,title,instrument,duration,reserved_credits,status,note_count,bpm,created_at,error_message FROM jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 50',(u['id'],)).fetchall()
    return {'jobs':[dict(r) for r in rows]}


@app.get('/api/jobs/{job_id}')
def job(request:Request,job_id:str):
    u=auth(request)
    with db() as c:
        row=c.execute('SELECT * FROM jobs WHERE id=? AND user_id=?',(job_id,u['id'])).fetchone()
    if not row:fail('Transcription introuvable.',404)
    result={k:row[k] for k in ['id','title','instrument','duration','reserved_credits','status','note_count','bpm','created_at','error_message']}
    if row['status']=='completed' and row['notes_json']:
        result['notes']=json.loads(row['notes_json'])
    return result


def work_job(job_id:str,source:Path,title:str,instrument:str):
    folder=EXPORTS/job_id
    try:
        with db() as c:c.execute('UPDATE jobs SET status=? WHERE id=?',('processing',job_id))
        result=process_file(str(source),title,instrument,str(folder))
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            r=c.execute('SELECT user_id,reserved_credits,status FROM jobs WHERE id=?',(job_id,)).fetchone()
            if r and r['status']=='processing':
                upd=c.execute('UPDATE users SET credits=credits-? WHERE id=? AND credits>=?',(r['reserved_credits'],r['user_id'],r['reserved_credits']))
                if upd.rowcount!=1:raise RuntimeError('Solde insuffisant lors de la finalisation')
                c.execute('UPDATE jobs SET status=?,notes_json=?,bpm=?,note_count=?,finished_at=? WHERE id=?',
                    ('completed',json.dumps(result['notes']),result['bpm'],result['note_count'],int(time.time()),job_id))
                c.execute('INSERT INTO credit_events(event_id,user_id,delta,source,created_at) VALUES(?,?,?,?,?)',
                          ('job:'+job_id,r['user_id'],-r['reserved_credits'],'transcription',int(time.time())))
    except Exception as e:
        with db() as c:
            c.execute('UPDATE jobs SET status=?,error_message=?,finished_at=? WHERE id=?',('failed',str(e)[:350],int(time.time()),job_id))
    finally:
        source.unlink(missing_ok=True)


@app.post('/api/jobs')
async def create_job(request:Request,background:BackgroundTasks,
    audio:UploadFile=File(...),title:str=Form('Ma partition'),instrument:str=Form('piano'),source_url:str=Form('')):
    check_origin(request);u=auth(request);rate_limit(request,'upload',12,3600)
    if instrument not in ('piano','guitare','voix','violon','basse'):fail('Instrument invalide.')
    title=title.strip()[:90] or 'Ma partition'
    filename=(audio.filename or '').lower()
    suffix=Path(filename).suffix
    if suffix not in ('.mp3','.wav','.m4a','.flac','.ogg','.aac'):fail('Fichier non compatible. MP3, WAV, M4A, FLAC, OGG ou AAC.')
    if source_url:
        inspect_link(request,LinkInput(url=source_url))
    job_id=uuid.uuid4().hex
    source=UPLOADS/f'{job_id}{suffix}'
    size=0
    try:
        with source.open('wb') as f:
            while chunk:=await audio.read(1024*1024):
                size+=len(chunk)
                if size>25*1024*1024:fail('Fichier trop volumineux (max. 25 Mo).',413)
                f.write(chunk)
        if size<1024:fail('Fichier audio trop petit ou invalide.')
        try:duration=get_duration(str(source))
        except Exception:fail('Impossible de lire la durée du fichier audio.')
        if duration>6*60:fail('Cette V1 accepte les fichiers de 6 minutes maximum.')
        cost=max(1,math.ceil(duration/60))
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            credit=int(c.execute('SELECT credits FROM users WHERE id=?',(u['id'],)).fetchone()['credits'])
            reserved=int(c.execute("SELECT COALESCE(SUM(reserved_credits),0) AS amount FROM jobs WHERE user_id=? AND status IN ('queued','processing')",(u['id'],)).fetchone()['amount'])
            if credit-reserved<cost:
                raise HTTPException(status_code=402,detail={'message':f'{cost} crédits nécessaires pour {math.ceil(duration)} secondes d’audio.','needed':cost,'available':credit-reserved})
            c.execute('INSERT INTO jobs(id,user_id,title,instrument,source_url,duration,reserved_credits,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
                (job_id,u['id'],title,instrument,source_url,duration,cost,'queued',int(time.time())))
        background.add_task(work_job,job_id,source,title,instrument)
        return {'id':job_id,'status':'queued','credits_reserved':cost,'duration':duration}
    except Exception:
        source.unlink(missing_ok=True)
        raise
    finally:
        await audio.close()


@app.get('/api/jobs/{job_id}/download/{format}')
def download(request:Request,job_id:str,format:str):
    u=auth(request)
    if format not in ('pdf','mid','musicxml'):fail('Format invalide.')
    with db() as c:
        row=c.execute('SELECT title,status FROM jobs WHERE id=? AND user_id=?',(job_id,u['id'])).fetchone()
    if not row or row['status']!='completed':fail('Export indisponible.',404)
    filename={'pdf':'score.pdf','mid':'score.mid','musicxml':'score.musicxml'}[format]
    target=EXPORTS/job_id/filename
    if not target.is_file():fail('Fichier indisponible.',404)
    slug=re.sub(r'[^a-z0-9-]','-',row['title'].lower())[:40].strip('-') or 'partition'
    return FileResponse(target,filename=f'{slug}.{format}',media_type={'pdf':'application/pdf','mid':'audio/midi','musicxml':'application/vnd.recordare.musicxml+xml'}[format])


@app.post('/api/checkout')
def checkout(request:Request,body:CheckoutInput):
    check_origin(request);u=auth(request);rate_limit(request,'checkout',10,3600)
    pack=PACKS.get(body.pack_id)
    if not pack:fail('Pack inconnu.')
    if not STRIPE_KEY or not STRIPE_WEBHOOK:fail('Le paiement n’est pas encore configuré complètement. Configurez Stripe et le webhook avant de lancer le service.',503)
    try:
        r=requests.post('https://api.stripe.com/v1/checkout/sessions',
          auth=(STRIPE_KEY,''),timeout=15,data={
            'mode':'payment','success_url':f'{BASE_URL}/app?checkout=success',
            'cancel_url':f'{BASE_URL}/app?checkout=cancel',
            'customer_email':u['email'],
            'line_items[0][price_data][currency]':'eur',
            'line_items[0][price_data][unit_amount]':str(pack['cents']),
            'line_items[0][price_data][product_data][name]':f"SongToSheet · {pack['credits']} crédits",
            'line_items[0][quantity]':'1',
            'metadata[user_id]':u['id'],'metadata[pack_id]':body.pack_id,
          })
        r.raise_for_status();result=r.json()
        if not result.get('url'):fail('Session de paiement indisponible.',502)
        return {'url':result['url']}
    except requests.RequestException:fail('Impossible de démarrer le paiement.',502)


def verify_stripe_signature(payload:bytes,header:str):
    if not STRIPE_WEBHOOK:fail('Webhook Stripe non configuré.',503)
    parts={}
    for item in header.split(','):
        k,_,v=item.partition('=')
        parts.setdefault(k,[]).append(v)
    try:
        ts=int(parts['t'][0]); signatures=parts['v1']
        if abs(time.time()-ts)>300:raise ValueError()
    except (ValueError,KeyError):fail('Signature Stripe invalide.',400)
    digest=hmac.new(STRIPE_WEBHOOK.encode(),str(ts).encode()+b'.'+payload,'sha256').hexdigest()
    if not any(hmac.compare_digest(digest,s) for s in signatures):fail('Signature Stripe invalide.',400)


@app.post('/api/stripe/webhook')
async def stripe_webhook(request:Request):
    payload=await request.body()
    verify_stripe_signature(payload,request.headers.get('stripe-signature',''))
    event=json.loads(payload)
    if event.get('type')!='checkout.session.completed':return {'received':True}
    obj=event.get('data',{}).get('object',{})
    if obj.get('mode')!='payment' or obj.get('payment_status')!='paid':return {'received':True}
    metadata=obj.get('metadata') or {}
    uid=metadata.get('user_id');pack_id=metadata.get('pack_id');pack=PACKS.get(pack_id)
    if not pack or obj.get('amount_total')!=pack['cents'] or obj.get('currency')!='eur':fail('Montant Stripe inattendu.',400)
    session_id=obj.get('id','')
    event_id='checkout:'+session_id if session_id else ''
    if not event_id or not uid:fail('Événement Stripe incomplet.',400)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        already=c.execute('SELECT event_id FROM credit_events WHERE event_id=?',(event_id,)).fetchone()
        if not already:
            c.execute('INSERT INTO credit_events(event_id,user_id,delta,source,created_at) VALUES(?,?,?,?,?)',
                      (event_id,uid,pack['credits'],'stripe',int(time.time())))
            c.execute('UPDATE users SET credits=credits+? WHERE id=?',(pack['credits'],uid))
    return {'received':True}


@app.get('/')
@app.get('/app')
@app.get('/connexion')
@app.get('/inscription')
@app.get('/legal')
def index():
    return FileResponse(ROOT/'web'/'index.html',media_type='text/html')