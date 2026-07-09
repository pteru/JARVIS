"""Tests for session_extract.py — mechanical transcript digest."""
import json

import session_extract as se


def _write(tmp_path, records):
    p = tmp_path / "session.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")
    return p


def _user(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def _assistant(text):
    return {"type": "assistant",
            "message": {"role": "assistant",
                        "content": [{"type": "text", "text": text}]}}


def test_extracts_user_and_turn_final_assistant(tmp_path):
    p = _write(tmp_path, [
        _user("faz X"),
        _assistant("vou fazer"),
        _assistant("X feito, resultado Y"),
        _user("agora Z"),
        _assistant("Z feito"),
    ])
    turns = se.extract(p)
    assert turns == [
        ("user", "faz X"),
        ("assistant", "X feito, resultado Y"),   # only the turn-FINAL text
        ("user", "agora Z"),
        ("assistant", "Z feito"),
    ]


def test_skips_meta_noise_and_tool_results(tmp_path):
    p = _write(tmp_path, [
        {"type": "user", "isMeta": True,
         "message": {"role": "user", "content": "meta"}},
        _user("<command-name>/jarvis</command-name>"),
        _user("<system-reminder>ignore</system-reminder>"),
        {"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "content": "big tool dump"}]}},
        _user("pergunta real"),
        _assistant("resposta"),
    ])
    assert se.extract(p) == [("user", "pergunta real"), ("assistant", "resposta")]


def test_skips_malformed_lines(tmp_path):
    p = tmp_path / "s.jsonl"
    p.write_text('not json\n' + json.dumps(_user("oi")), encoding="utf-8")
    assert se.extract(p) == [("user", "oi")]


def test_cli_truncates_long_messages(tmp_path, capsys):
    p = _write(tmp_path, [_user("a" * 500), _assistant("fim")])
    assert se.main([str(p), "--max-msg", "100"]) == 0
    out = capsys.readouterr().out
    assert "a" * 100 + " […]" in out
    assert "a" * 101 not in out


def test_cli_total_cap(tmp_path, capsys):
    p = _write(tmp_path, [_user("x" * 300), _assistant("y" * 300),
                          _user("z" * 300)])
    assert se.main([str(p), "--max-total", "400"]) == 0
    out = capsys.readouterr().out
    assert "[truncado" in out


def test_skips_valid_json_that_is_not_a_dict_record(tmp_path):
    p = tmp_path / "s.jsonl"
    p.write_text(
        "[1, 2, 3]\n42\n"
        + json.dumps({"type": "user", "message": "not-a-dict"}) + "\n"
        + json.dumps(_user("oi")),
        encoding="utf-8",
    )
    assert se.extract(p) == [("user", "oi")]
