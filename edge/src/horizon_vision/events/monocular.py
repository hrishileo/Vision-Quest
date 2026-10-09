"""Monocular ground-plane position from a pixel box and camera pose.

The box's ground-contact pixel (bottom center) is cast as a ray and
intersected with the ground plane. Speed is not computed here; the tracker
derives it from successive positions.

This is the CAM0 camera from the Vision-Quest recorder:

- World ``+X`` east, ``+Y`` up, ``+Z`` south. The ground plane is ``y = 0``.
- ``yaw``, ``pitch``, ``roll`` are a Three.js Euler in order YXZ, with
  components ``(pitch, yaw, roll)``.
- The camera looks down local ``-Z``. Camera ``+X`` is image right. Camera
  ``+Y`` is image up.
- At yaw = pitch = roll = 0 the optical axis points north (world ``-Z``),
  camera right is east, and camera up is world up.
- Positive yaw turns the look direction from north toward west. Positive
  pitch looks up. Negative pitch looks down at the road.

A pixel ``(u, v)`` (top-left origin, ``+v`` down) becomes::

    X = (u - cx) / fx
    Y = (cy - v) / fy
    dir_camera = (X, Y, -1)

``dir_world`` is that vector rotated by the YXZ matrix. The ground hit is
``position + t * dir_world`` with ``t = (ground_y - position.y) / dir_world.y``
when the ray descends. On the recorder, ``agl == position.y`` and the ground
is ``y = 0``.

Event ``x, y`` are east and south of that hit (world ``X`` and ``Z``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from horizon_vision.events.labels import BBox, CameraIntrinsics, CameraPose

_RAY_EPS = 1e-9


@dataclass(frozen=True, slots=True)
class GroundEstimate:
    x: float
    y: float
    confidence: float


def world_from_camera(yaw: float, pitch: float, roll: float) -> np.ndarray:
    """Three.js ``Matrix4.makeRotationFromEuler`` for order YXZ.

    Columns are the camera +X, +Y, and +Z axes in world coordinates.
    ``pitch`` is Euler x, ``yaw`` is Euler y, ``roll`` is Euler z.
    """
    a = math.cos(pitch)
    b = math.sin(pitch)
    c = math.cos(yaw)
    d = math.sin(yaw)
    e = math.cos(roll)
    f = math.sin(roll)
    ce = c * e
    cf = c * f
    de = d * e
    df = d * f
    return np.array(
        [
            [ce + df * b, de * b - cf, a * d],
            [a * f, a * e, -b],
            [cf * b - de, df + ce * b, a * c],
        ],
        dtype=float,
    )


def estimate_ground_point(
    bbox: BBox,
    pose: CameraPose,
    intrinsics: CameraIntrinsics,
) -> GroundEstimate | None:
    """Intersect the box's ground-contact ray with the plane under the camera.

    Returns ``None`` when the ray does not descend into the ground in front
    of the camera.
    """
    fx = intrinsics.focal_x
    fy = intrinsics.focal_y
    if pose.agl <= 0 or fx <= 0 or fy <= 0:
        return None
    u, v = bbox.ground_contact
    direction_cam = np.array(
        [
            (u - intrinsics.cx) / fx,
            (intrinsics.cy - v) / fy,
            -1.0,
        ],
        dtype=float,
    )
    direction = world_from_camera(pose.yaw, pose.pitch, pose.roll) @ direction_cam
    if direction[1] >= -_RAY_EPS:
        return None
    ground_y = pose.y - pose.agl
    scale = (ground_y - pose.y) / direction[1]
    if scale <= 0:
        return None
    point = np.array([pose.x, pose.y, pose.z], dtype=float) + scale * direction
    norm = float(np.linalg.norm(direction))
    if norm < _RAY_EPS:
        return None
    # Straight down is confident. A grazing ray is not.
    confidence = float(np.clip(abs(direction[1]) / norm, 0.0, 1.0))
    return GroundEstimate(x=float(point[0]), y=float(point[2]), confidence=confidence)
