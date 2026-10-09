"""Horizon Vision hub portion of the ``horizon_vision`` package.

Street graph, A* routing, and reroute alerts live in ``horizon_vision.hub``.
Put ``edge/src`` ahead of ``hub/src`` on ``PYTHONPATH`` so the edge package
init loads first; this file still extends ``__path__`` if it loads first.
"""

from pkgutil import extend_path

__path__ = extend_path(__path__, __name__)
__version__ = "0.1.0"
