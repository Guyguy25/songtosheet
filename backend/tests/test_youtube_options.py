from track_link import youtube_options


def test_default_options_keep_plugins_off(monkeypatch):
    monkeypatch.delenv("TRACK_YTDLP_POT_HOME", raising=False)
    monkeypatch.delenv("TRACK_YTDLP_PROXY", raising=False)
    options = youtube_options()
    assert "--no-plugin-dirs" in options and "--proxy" not in options


def test_po_token_provider_and_proxy(monkeypatch):
    monkeypatch.setenv("TRACK_YTDLP_POT_HOME", "/opt/bgutil/server")
    monkeypatch.setenv("TRACK_YTDLP_PROXY", "http://user:pass@proxy.example:8000")
    options = youtube_options()
    assert "--no-plugin-dirs" not in options  # the PO token provider is a yt-dlp plugin
    assert options[options.index("--extractor-args") + 1] == "youtubepot-bgutilscript:server_home=/opt/bgutil/server"
    assert options[options.index("--proxy") + 1] == "http://user:pass@proxy.example:8000"


def test_cookies_from_secret_are_written_to_a_private_file(monkeypatch, tmp_path):
    import os
    monkeypatch.delenv("TRACK_YTDLP_POT_HOME", raising=False)
    monkeypatch.setenv("TRACK_YTDLP_COOKIES", "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n")
    monkeypatch.setattr("tempfile.gettempdir", lambda: str(tmp_path))
    options = youtube_options()
    path = options[options.index("--cookies") + 1]
    assert open(path).read().startswith("# Netscape")
    assert oct(os.stat(path).st_mode & 0o777) == "0o600"
