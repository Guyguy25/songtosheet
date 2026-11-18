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
    extractor_args = [options[i + 1] for i, option in enumerate(options) if option == "--extractor-args"]
    assert "youtubepot-bgutilscript:server_home=/opt/bgutil/server" in extractor_args
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


def test_error_details_hide_proxy_credentials(monkeypatch):
    from track_link import redact
    monkeypatch.setenv("TRACK_YTDLP_PROXY", "http://user:s3cret@gw.example:823")
    text = redact("ERROR: Unable to connect to proxy http://user:s3cret@gw.example:823 (407)")
    assert "s3cret" not in text and "user:" not in text and "407" in text


def test_dataimpulse_proxy_keeps_one_ip_per_download(monkeypatch):
    monkeypatch.setenv("TRACK_YTDLP_PROXY", "http://abc:pw@gw.dataimpulse.com:823")
    first = youtube_options()
    proxy = first[first.index("--proxy") + 1]
    assert proxy.startswith("http://abc__sessid.") and proxy.endswith(":pw@gw.dataimpulse.com:823")
    second = youtube_options()
    assert second[second.index("--proxy") + 1] != proxy  # a new IP for each download


def test_dataimpulse_login_with_parameters(monkeypatch):
    monkeypatch.setenv("TRACK_YTDLP_PROXY", "http://abc__cr.fr:pw@gw.dataimpulse.com:823")
    options = youtube_options()
    assert options[options.index("--proxy") + 1].startswith("http://abc__cr.fr;sessid.")
