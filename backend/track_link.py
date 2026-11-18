"""Download a public HTTPS audio file for a transcription job."""
import ipaddress
from pathlib import Path
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


def redact(text):
    """Remove proxy credentials from yt-dlp output before it reaches the logs."""
    proxy = os.getenv("TRACK_YTDLP_PROXY")
    if proxy:
        text = text.replace(proxy, "[proxy]")
    return re.sub(r"//[^/@\s]+@", "//[identifiants]@", text)


def log_failure(where, result):
    details = redact((result.stderr + result.stdout).decode("utf-8", errors="replace"))
    lines = [line for line in details.splitlines() if "ERROR" in line or "WARNING" in line][-6:]
    print(f"yt-dlp ({where}) a échoué : " + (" | ".join(lines) or details[-800:]), file=sys.stderr, flush=True)


def sticky_proxy(proxy):
    """Keep one exit IP for a whole download.

    YouTube signs its media links for the IP that asked for them: with a rotating
    residential proxy the page and the audio come from different IPs and the audio
    request gets 403.  DataImpulse keeps an IP per `sessid` (about 30 minutes)."""
    from urllib.parse import urlsplit, urlunsplit
    import secrets

    parts = urlsplit(proxy)
    if not (parts.hostname or "").endswith("dataimpulse.com") or not parts.username:
        return proxy
    session = "sessid." + secrets.token_hex(6)
    login = parts.username + (";" if "__" in parts.username else "__") + session
    host = parts.hostname + (f":{parts.port}" if parts.port else "")
    credentials = login + (f":{parts.password}" if parts.password is not None else "")
    return urlunsplit((parts.scheme, f"{credentials}@{host}", parts.path, parts.query, parts.fragment))


def youtube_options():
    """Common yt-dlp options for YouTube.

    TRACK_YTDLP_POT_HOME: bgutil PO-token provider (server folder) so YouTube accepts
    downloads from cloud servers; TRACK_YTDLP_PROXY: optional proxy for YouTube only;
    TRACK_YTDLP_COOKIES: optional cookies.txt content of a (secondary) YouTube account."""
    options = ["--ignore-config"]
    pot_home = os.getenv("TRACK_YTDLP_POT_HOME")
    # Cloud: keep YouTube's player code between downloads of the same container.
    options += ["--cache-dir", "/tmp/yt-dlp-cache"] if pot_home else ["--no-cache-dir"]
    # Audio only: the HLS manifests YouTube also lists cost 1.3-2.5 s per download (measured).
    options += ["--extractor-args", "youtube:skip=hls"]
    if pot_home:
        options += ["--extractor-args", f"youtubepot-bgutilscript:server_home={pot_home}"]
    else:
        options.append("--no-plugin-dirs")
    proxy = os.getenv("TRACK_YTDLP_PROXY")
    if proxy:
        options += ["--proxy", sticky_proxy(proxy)]
    cookies = os.getenv("TRACK_YTDLP_COOKIES")
    if cookies:
        # Netscape cookie file of a YouTube account, stored as a secret: written to a
        # private file because yt-dlp only reads cookies from a file.
        import tempfile

        path = os.path.join(tempfile.gettempdir(), "songtosheet-youtube-cookies.txt")
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(cookies.replace("\\n", "\n"))
        os.chmod(path, 0o600)
        options += ["--cookies", path]
    return options


def race(commands, outputs, timeout, env=None):
    """Run the commands at the same time; the first to exit 0 with its output file (>= 1 KB)
    wins and the others are stopped.  Returns (winner index or None, CompletedProcess list)."""
    import tempfile
    import time

    logs = [tempfile.TemporaryFile() for _ in commands]
    processes = []
    try:
        for command, log in zip(commands, logs):
            processes.append(subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=env))
        deadline = time.monotonic() + timeout
        winner = None
        while winner is None and time.monotonic() < deadline:
            running = False
            for index, process in enumerate(processes):
                code = process.poll()
                if code is None:
                    running = True
                elif code == 0 and Path(outputs[index]).is_file() and Path(outputs[index]).stat().st_size >= 1024:
                    winner = index
                    break
            if winner is None and not running:
                break
            time.sleep(.1)
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    results = []
    for command, process, log in zip(commands, processes, logs):
        log.seek(0)
        results.append(subprocess.CompletedProcess(command, process.returncode, b"", log.read()))
        log.close()
    return winner, results


def download_youtube_section(video_id, directory, start, end):
    """Fetch only [start, end] seconds of a video's audio (much faster for previews).

    With a residential proxy, two attempts race through two different exit IPs: some IPs
    crawl (13 KB/s measured, 34 s for a 30 s excerpt) or fail, and the first good one wins.
    Returns (audio, full duration in seconds) or None when it fails, so the caller can
    fall back to downloading the whole audio."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise TrackLinkError("Colle un lien vers une vidéo ou un Short YouTube.")
    attempts = 2 if os.getenv("TRACK_YTDLP_PROXY") else 1
    commands, outputs, infos = [], [], []
    for attempt in range(attempts):
        folder = directory / f"section-{attempt}"
        folder.mkdir(parents=True, exist_ok=True)
        infos.append(folder / "youtube-duration.txt")
        outputs.append(folder / "section.m4a")
        commands.append([
            sys.executable, "-m", "yt_dlp", *youtube_options(),  # a new proxy session (exit IP) each
            "--no-playlist", "--js-runtimes", "node", "--socket-timeout", "12",
            "--extractor-retries", "2", "--retries", "2", "--fragment-retries", "2",
            "--match-filter", "!is_live", "--no-simulate", "--print-to-file", "%(duration)s", str(infos[-1]),
            "--format", "bestaudio[ext=m4a]/bestaudio/best[acodec!=none]",
            "--download-sections", f"*{max(0.0, start):.2f}-{end:.2f}",
            "--extract-audio", "--audio-format", "m4a",
            "--no-progress", "-o", str(folder / "section.%(ext)s"),
            "--", "https://www.youtube.com/watch?v=" + video_id,
        ])
    environment = {key: value for key, value in os.environ.items() if key != "TRACK_WORKER_TOKEN"}
    try:
        winner, results = race(commands, outputs, timeout=90, env=environment)
    except OSError:
        return None
    if winner is None or outputs[winner].stat().st_size > MAX_BYTES:
        for result in results:
            log_failure("extrait", result)
        return None
    try:
        duration = float(infos[winner].read_text(encoding="utf-8").split()[0])
    except (OSError, ValueError, IndexError):
        return None
    audio = directory / "section.m4a"
    outputs[winner].replace(audio)
    return audio, duration


def download_youtube(video_id, directory, light=False):
    """Whole audio of a video. light: a small Opus stream (~70 kb/s, half the bytes through the
    proxy) kept as is, enough for analysing a preview; otherwise the best m4a."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise TrackLinkError("Colle un lien vers une vidéo ou un Short YouTube.")
    command = [
        sys.executable, "-m", "yt_dlp", *youtube_options(),
        "--no-playlist", "--js-runtimes", "node", "--socket-timeout", "12",
        "--extractor-retries", "2", "--retries", "2", "--fragment-retries", "2",
        "--max-filesize", "25M", "--match-filter", "!is_live",
        "--format", ("250/249/251/bestaudio[ext=m4a]/bestaudio/best[acodec!=none]" if light
                     else "bestaudio[ext=m4a]/bestaudio/best[acodec!=none]"),
        "--extract-audio", "--audio-format", "opus" if light else "m4a",
        "--no-progress", "-o", str(directory / "input.%(ext)s"),
        "--", "https://www.youtube.com/watch?v=" + video_id,
    ]
    environment = {key: value for key, value in os.environ.items() if key != "TRACK_WORKER_TOKEN"}
    try:
        result = subprocess.run(command, capture_output=True, timeout=120, check=False, env=environment)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise TrackLinkError("La récupération de l’audio YouTube a échoué. Réessaie dans un instant.") from error
    audio = directory / ("input.opus" if light else "input.m4a")
    if result.returncode or not audio.is_file():
        log_failure("complet", result)
        details = (result.stderr + result.stdout).decode("utf-8", errors="replace").lower()
        if "private video" in details or "video unavailable" in details:
            raise TrackLinkError("Cette vidéo YouTube est privée ou indisponible. Vérifie que le lien s’ouvre sans connexion.")
        if "sign in to confirm" in details:
            raise TrackLinkError("YouTube bloque l’accès à l’audio de cette vidéo. Tu peux importer le fichier audio directement.")
        if "larger than max-filesize" in details or "file is larger than" in details:
            raise TrackLinkError("L’audio YouTube dépasse la limite de 25 Mo.")
        raise TrackLinkError("Impossible de récupérer l’audio YouTube pour le moment. Réessaie ou importe le fichier audio.")
    if not 1024 <= audio.stat().st_size <= MAX_BYTES:
        raise TrackLinkError("La taille de l’audio YouTube doit être comprise entre 1 Ko et 25 Mo.")
    return audio
