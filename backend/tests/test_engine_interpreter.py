import os
import sys

import pytest

from engine_process import interpreter


def test_interpreter_keeps_the_virtualenv_symlink(tmp_path):
    # A venv's python is a symlink to the base interpreter; following it loses the venv packages.
    link = tmp_path / "venv" / "bin" / "python"
    link.parent.mkdir(parents=True)
    os.symlink(sys.executable, link)
    assert interpreter(str(link)) == link


def test_interpreter_must_exist(tmp_path):
    with pytest.raises(FileNotFoundError):
        interpreter(str(tmp_path / "missing" / "python"))
