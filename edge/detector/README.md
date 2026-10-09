# CAM0 detector

Two classes, matching the recorder: `vehicle` (0) and `unknown` (1, debris and blockades). The real debris type stays on the label. The network does not see it.

Sequences are rendered by the pursuit recorder, then split by sequence id into train / val / test. A frame never moves to another split without the rest of its clip.

```bash
node --experimental-strip-types scripts/record-corpus.ts --out data/yolo
pip install -r edge/detector/requirements.txt
python edge/detector/train.py --data data/yolo/data.yaml
PYTHONPATH=edge/src python edge/detector/compare.py \
  --data data/yolo --weights edge/detector/runs/cam0/weights/best.pt
python edge/detector/export.py --weights edge/detector/runs/cam0/weights/best.pt
```

`train.py` fine-tunes `yolov8n.pt` on CPU (`edge/detector/config.yaml`). Swap `--model yolo11n.pt` for YOLO11n. Checkpoints, the corpus under `data/yolo/`, and ONNX files are gitignored. `sample/` is two committed frames.

Export writes `best.onnx` beside the checkpoint. On the Jetson Orin Nano:

```bash
/usr/src/tensorrt/bin/trtexec --onnx=best.onnx --saveEngine=best.fp16.engine --fp16
```

`horizon_vision.events.detect` feeds those boxes into the existing track hold, monocular ground hit, tailgate, and lane-state code. Pose still comes from the camera. Lane comes from the ground hit, not from the label.
