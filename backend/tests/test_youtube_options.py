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
