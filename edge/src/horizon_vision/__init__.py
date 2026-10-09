"""Horizon Vision edge package (events, sensors, perception, mapping).

The hub portion lives in ``hub/src`` and is found when that directory is on
``PYTHONPATH`` after ``edge/src``. ``edge/legacy`` is a separate tree and is
not on this path.
"""

from pkgutil import extend_path

__path__ = extend_path(__path__, __name__)
__version__ = "0.1.0"
