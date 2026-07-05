import json

from drive_audit import (classify, load_drive_entries, main, render_markdown,
                         scan_project, suggest_destination)

DRIVE_INDEX = {
    "project": "99999", "name": "Fixture", "generated": "2026-07-04T00:00:00Z",
    "stats": {"folders": 3, "files": 2, "skipped": 0},
    "sources": [{
        "name": "[99999] FIXTURE", "driveName": "[03] VISION KING",
        "role": "internal", "folderId": "rootid",
        "entries": [
            {"path": "01-Desenhos/", "type": "folder", "id": "f1",
             "mimeType": "application/vnd.google-apps.folder", "size": 0},
            {"path": "01-Desenhos/CAD/", "type": "folder", "id": "f2",
             "mimeType": "application/vnd.google-apps.folder", "size": 0},
            {"path": "02-Documentos/", "type": "folder", "id": "f3",
             "mimeType": "application/vnd.google-apps.folder", "size": 0},
            {"path": "02-Documentos/SOR-R03.docx", "type": "file", "id": "d1",
             "mimeType": "application/vnd.x", "size": 12345},
            {"path": "01-Desenhos/CAD/peca.stl", "type": "file", "id": "d2",
             "mimeType": "model/stl", "size": 999},
        ],
    }],
}


def test_classify():
    assert classify("a.pdf") == "document"
    assert classify("B.STL") == "cad"
    assert classify("x.zip") == "archive"
    assert classify("dump.sql") == "data"
    assert classify("notes.md") == "text"
    assert classify("weird.xyz") == "other"


def test_load_drive_entries(tmp_path):
    p = tmp_path / "drive-index.json"
    p.write_text(json.dumps(DRIVE_INDEX), encoding="utf-8")
    filenames, folders = load_drive_entries(p)
    assert "sor-r03.docx" in filenames and "peca.stl" in filenames
    assert "01-Desenhos/CAD" in folders and "02-Documentos" in folders


def test_suggest_destination():
    folders = ["01-Desenhos/CAD", "02-Documentos"]
    assert suggest_destination("cad", folders) == "01-Desenhos/CAD"
    assert suggest_destination("document", folders) == "02-Documentos"
    assert suggest_destination("other", folders) == "?"


def test_scan_project_flags_and_skips(tmp_path):
    root = tmp_path / "99999"
    (root / "drawings").mkdir(parents=True)
    (root / "emails").mkdir()
    (root / "knowledge").mkdir()
    big = root / "drawings" / "modelo.stl"
    big.write_bytes(b"x" * (6 * 1024 * 1024))          # 6 MB -> flagged (size)
    (root / "drawings" / "peca.stl").write_bytes(b"x")  # tiny but on Drive -> flagged
    (root / "notas.md").write_text("pequeno\n", encoding="utf-8")   # not flagged
    (root / "emails" / "big.sql").write_bytes(b"x" * (9 * 1024 * 1024))  # skipped dir
    (root / "knowledge" / "contexto.md").write_text("x", encoding="utf-8")  # skipped dir
    rows = scan_project(root, 5 * 1024 * 1024, {"peca.stl"})
    paths = [r["path"] for r in rows]
    assert paths == ["drawings/modelo.stl", "drawings/peca.stl"]  # size-desc order
    assert rows[0]["on_drive"] is False and rows[1]["on_drive"] is True
    assert rows[0]["class"] == "cad"


def test_main_end_to_end(tmp_path, capsys):
    root = tmp_path
    proj = root / "99999"
    proj.mkdir()
    (proj / "grande.zip").write_bytes(b"x" * (6 * 1024 * 1024))
    (proj / "drive-index.json").write_text(json.dumps(DRIVE_INDEX), encoding="utf-8")
    rc = main(["99999", "--root", str(root), "--min-size", "5"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "grande.zip" in out and "6.0 MB" in out
    assert "| archive |" in out


def test_main_missing_drive_index(tmp_path, capsys):
    (tmp_path / "88888").mkdir()
    rc = main(["88888", "--root", str(tmp_path)])
    assert rc == 0
    assert "sem drive-index" in capsys.readouterr().out.lower()
