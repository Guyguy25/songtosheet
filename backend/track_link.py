"""Download a public HTTPS audio file for a transcription job."""
import ipaddress
import os
import re
import socket
import ssl
import subprocess
import sys
import time
from http.client import HTTPException, HTTPSConnection
from urllib.parse import quote, urljoin, urlsplit


MAX_BYTES = 25 * 1024 * 1024
GLOBAL_IPV6 = ipaddress.ip_network("2000::/3")
TYPES = {
    "audio/mpeg": "mp3", "audio/mp3": "mp3",
    "audio/wav": "wav", "audio/wave": "wav", "audio/x-wav": "wav",
    "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
    "audio/flac": "flac", "audio/x-flac": "flac",
    "audio/ogg": "ogg", "application/ogg": "ogg",
    "audio/aac": "aac", "audio/x-aac": "aac",
}


class TrackLinkError(ValueError):
    pass


def public_destination(url):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.port not in (None, 443)
            or parsed.username is not None or parsed.password is not None):
        raise TrackLinkError("Utilise un lien HTTPS public vers un fichier audio.")
    host = parsed.hostname.encode("idna").decode("ascii")
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    ips = list(dict.fromkeys(ipaddress.ip_address(result[4][0]) for result in addresses))
    for ip in ips:
        if (not ip.is_global or ip.is_multicast or ip.is_reserved
                or (ip.version == 6 and (ip not in GLOBAL_IPV6 or ip.sixtofour or ip.teredo))):
            raise TrackLinkError("Utilise un lien HTTPS public vers un fichier audio.")
    return parsed, host, ips


def connect_public(host, ips):
    context = ssl.create_default_context()
    # Pin the TCP destination while verifying the original hostname over TLS.
    for ip in ips[:4]:
        try:
            with socket.create_connection((str(ip), 443), timeout=5) as raw:
                return context.wrap_socket(raw, server_hostname=host)
        except OSError:
            continue
    raise OSError("No verified HTTPS connection")


def download_track(url, directory):
    deadline = time.monotonic() + 90
    try:
        for _ in range(5):
            parsed, host, ips = public_destination(url)
            path = quote(parsed.path or "/", safe="/%:@!$&'()*+,;=-._~")
            if parsed.query:
                path += "?" + quote(parsed.query, safe="/?%:@!$&'()*+,;=-._~")
            connection = HTTPSConnection(host, timeout=10)
            response = None
            try:
                connection.sock = connect_public(host, ips)
                connection.request("GET", path, headers={
                    "Accept-Encoding": "identity",
                    "User-Agent": "SongToSheet/1.0 (+https://songtosheet.vercel.app)",
                })
                response = connection.getresponse()
                if response.status in (301, 302, 303, 307, 308) and response.headers.get("Location"):
                    url = urljoin(url, response.headers["Location"])
                    continue
                if response.status != 200:
                    break
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                extension = TYPES.get(content_type)
                if content_type == "application/octet-stream":
                    suffix = parsed.path.rsplit(".", 1)[-1].lower()
                    if suffix in TYPES.values():
                        extension = suffix
                if not extension:
                    raise TrackLinkError("Le lien doit ouvrir directement un fichier audio, par exemple un MP3.")
                if int(response.headers.get("Content-Length") or 0) > MAX_BYTES:
                    raise TrackLinkError("Le fichier audio dépasse la limite de 25 Mo.")
                destination = directory / f"input.{extension}"
                size = 0
                with destination.open("wb") as output:
                    while chunk := response.read1(64 * 1024):
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise TrackLinkError("Le fichier audio dépasse la limite de 25 Mo.")
                        if time.monotonic() >= deadline:
                            raise TrackLinkError("Le téléchargement de l’audio a pris trop de temps.")
                        output.write(chunk)
                if size >= 1024:
                    return destination
                break
            finally:
                if response is not None:
                    response.close()
                connection.close()
    except TrackLinkError:
        raise
    except (HTTPException, OSError, ValueError):
        pass
    raise TrackLinkError("Impossible de récupérer l’audio. Vérifie que le fichier est accessible sans connexion.")


def download_youtube(video_id, directory):
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise TrackLinkError("Colle un lien vers une vidéo ou un Short YouTube.")
    command = [
        sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-plugin-dirs", "--no-cache-dir",
        "--no-playlist", "--js-runtimes", "node", "--socket-timeout", "12",
        "--extractor-retries", "0", "--retries", "0", "--fragment-retries", "0",
        "--max-filesize", "25M", "--match-filter", "!is_live",
        "--format", "bestaudio[ext=m4a]/bestaudio", "--extract-audio", "--audio-format", "m4a",
        "--no-progress", "-o", str(directory / "input.%(ext)s"),
        "--", "https://www.youtube.com/watch?v=" + video_id,
    ]
    environment = {key: value for key, value in os.environ.items() if key != "TRACK_WORKER_TOKEN"}
    try:
        result = subprocess.run(command, capture_output=True, timeout=120, check=False, env=environment)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise TrackLinkError("La récupération de l’audio YouTube a échoué. Réessaie dans un instant.") from error
    audio = directory / "input.m4a"
    if result.returncode or not audio.is_file():
        raise TrackLinkError("Impossible de récupérer cette vidéo YouTube. Utilise une vidéo publique accessible.")
    if not 1024 <= audio.stat().st_size <= MAX_BYTES:
        raise TrackLinkError("La taille de l’audio YouTube doit être comprise entre 1 Ko et 25 Mo.")
    return audio
