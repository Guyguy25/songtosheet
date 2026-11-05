import hashlib
import hmac
import io
import json
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as webapp


@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(webapp,'DB',tmp_path/'test.db')
    monkeypatch.setattr(webapp,'DATA',tmp_path)
    monkeypatch.setattr(webapp,'EXPORTS',tmp_path/'exports')
    monkeypatch.setattr(webapp,'UPLOADS',tmp_path/'uploads')
    webapp.EXPORTS.mkdir();webapp.UPLOADS.mkdir()
    monkeypatch.setattr(webapp,'STRIPE_KEY','')
    monkeypatch.setattr(webapp,'STRIPE_WEBHOOK','whsec_test_secret')
    webapp.init_db()
    with TestClient(webapp.app) as c:
        yield c


def signup(client):
    r=client.post('/api/auth/signup',json={'email':'demo@example.com','password':'password-123'})
    assert r.status_code==200,r.text
    assert r.json()['user']['credits']==0
    return r.json()['user']


def stripe_event(client,uid,pack='standard',event_id='evt_123'):
    price=webapp.PACKS[pack]['cents']
    event={'id':event_id,'type':'checkout.session.completed',
         'data':{'object':{'id':'cs_test_123','mode':'payment','payment_status':'paid','metadata':{'user_id':uid,'pack_id':pack},
                           'amount_total':price,'currency':'eur'}}}
    payload=json.dumps(event,separators=(',',':')).encode()
    ts=int(time.time());digest=hmac.new(b'whsec_test_secret',str(ts).encode()+b'.'+payload,'sha256').hexdigest()
    return client.post('/api/stripe/webhook',content=payload,headers={'stripe-signature':f't={ts},v1={digest}'})


def test_signup_login_zero_free_credits(client):
    signup(client)
    assert client.get('/api/auth/me').json()['user']['credits']==0
    assert client.post('/api/auth/signup',json={'email':'demo@example.com','password':'password-123'}).status_code==409
    assert client.post('/api/auth/logout').status_code==200
    assert client.get('/api/jobs').status_code==401
    assert client.post('/api/auth/login',json={'email':'demo@example.com','password':'wrong-password'}).status_code==401
    assert client.post('/api/auth/login',json={'email':'demo@example.com','password':'password-123'}).status_code==200


def test_link_is_reference_not_download(client):
    response=client.post('/api/links/inspect',json={'url':'https://www.youtube.com/watch?v=abc123'})
    assert response.status_code==200
    assert response.json()['requires_audio'] is True
    assert client.post('/api/links/inspect',json={'url':'http://evil.com/file'}).status_code==400
    assert client.post('/api/links/inspect',json={'url':'https://evil.com/file'}).status_code==400


def test_billing_webhook_signature_idempotence(client):
    user=signup(client)
    invalid=client.post('/api/stripe/webhook',content=b'{}',headers={'stripe-signature':'t=0,v1=0'})
    assert invalid.status_code==400
    good=stripe_event(client,user['id']);assert good.status_code==200,good.text
    assert stripe_event(client,user['id']).status_code==200
    assert client.get('/api/auth/me').json()['user']['credits']==30
    assert client.post('/api/checkout',json={'pack_id':'standard'}).status_code==503


def test_audio_job_and_exports(client):
    user=signup(client)
    path=Path(__file__).parent/'melody.wav'
    audio=path.read_bytes()
    no_money=client.post('/api/jobs',files={'audio':('melody.wav',audio,'audio/wav')},data={'title':'Ma mélodie','instrument':'piano'})
    assert no_money.status_code==402,no_money.text
    assert not list(webapp.UPLOADS.iterdir())
    assert stripe_event(client,user['id'],'starter').status_code==200
    result=client.post('/api/jobs',files={'audio':('melody.wav',audio,'audio/wav')},data={'title':'Mélodie originale','instrument':'piano'})
    assert result.status_code==200,result.text
    jid=result.json()['id']
    job=client.get(f'/api/jobs/{jid}').json()
    assert job['status']=='completed',job
    assert job['note_count']>=3
    assert client.get('/api/auth/me').json()['user']['credits']==9
    for fmt in ['pdf','mid','musicxml']:
        resp=client.get(f'/api/jobs/{jid}/download/{fmt}')
        assert resp.status_code==200,resp.text
        assert len(resp.content)>40
    assert client.get('/api/jobs/unknown/download/pdf').status_code==404