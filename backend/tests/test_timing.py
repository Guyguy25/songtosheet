import timing


def test_timed_call_logs_label_and_duration(capsys):
    timing.start_job()
    assert timing.timed_call("Demucs", lambda x: x * 2)(21) == 42
    line = capsys.readouterr().out
    assert line.startswith("chrono Demucs: ") and "s → " in line and line.rstrip().endswith("s)")


def test_timed_call_logs_even_on_error(capsys):
    def boom():
        raise ValueError("x")
    try:
        timing.timed_call("Tsumugi", boom)()
    except ValueError:
        pass
    assert "chrono Tsumugi:" in capsys.readouterr().out
