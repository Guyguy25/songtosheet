"""Engrave the editable MusicXML export as a printable A4 PDF."""
import html
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def chromium_path():
    configured = os.getenv("TRACK_PDF_BROWSER")
    if configured:
        return configured
    for executable in ("chromium", "chromium-browser", "google-chrome", "msedge"):
        found = shutil.which(executable)
        if found:
            return found
    for env in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        if directory := os.getenv(env):
            for relative in ("Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"):
                candidate = Path(directory) / relative
                if candidate.is_file():
                    return str(candidate)
    raise ValueError("Chromium est nécessaire pour le rendu PDF.")


def render_pdf(folder: Path, title: str, instrument: str, format: str, destination: Path):
    import verovio

    tab = format == "tablature" and (folder / "tab.musicxml").is_file()
    source = folder / ("tab.musicxml" if tab else "score.musicxml")
    score = verovio.toolkit()
    score.setOptions({"inputFrom": "xml", "breaks": "auto", "header": "none",
                      "footer": "none", "pageWidth": 2100, "pageHeight": 2670,
                      "scale": 54, "svgViewBox": True})
    if not score.loadFile(str(source)) or not (count := score.getPageCount()):
        raise ValueError("La mise en page PDF a échoué.")

    label = "Tablature" if tab else "Partition"
    title = html.escape(title)
    instrument = html.escape(instrument.capitalize())
    pages = [
        f"<section><h1>{title}</h1><p>{label} · {instrument} · Relevé automatique</p>"
        f"{score.renderToSVG(page)}<footer>{page} / {count}</footer></section>"
        for page in range(1, count + 1)
    ]
    with tempfile.TemporaryDirectory() as temporary:
        work = Path(temporary)
        document = work / "score.html"
        document.write_text(
            f"""<!doctype html><html lang="fr"><meta charset="utf-8"><title>{title}</title>
            <style>
            @page {{size:A4;margin:0}}
            * {{box-sizing:border-box}}
            body {{margin:0;color:#17151e;font-family:Arial,sans-serif}}
            section {{position:relative;height:297mm;padding:12mm 11mm 10mm;break-after:page;overflow:hidden}}
            section:last-of-type {{break-after:auto}}
            h1 {{font-size:17pt;margin:0 0 2mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
            p {{font-size:10pt;margin:0 0 3mm}}
            section>svg {{width:100%;height:248mm;display:block}}
            footer {{position:absolute;right:11mm;bottom:9mm;font-size:9pt}}
            </style><body>{''.join(pages)}</body></html>""", encoding="utf-8"
        )
        command = [chromium_path(), "--headless", "--no-pdf-header-footer", "--disable-gpu",
                   "--no-first-run", "--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND",
                   f"--user-data-dir={work / 'profile'}", f"--print-to-pdf={destination.resolve()}",
                   document.as_uri()]
        result = subprocess.run(command, capture_output=True, timeout=45)
        if result.returncode or not destination.is_file():
            raise ValueError("La mise en page PDF a échoué.")
