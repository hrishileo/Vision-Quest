# Detection record

Same 10 VisDrone2019-DET-val frames every run (Jarvis's set, `/workspace/yolo-preview/frames.json`).
A hit is IoU >= 0.5 with the right class. Missed = labeled - found. Confidence 0.25, image size 640.
Labeled: vehicle 59, person 34, bicycle 8, motor 26 (motor includes VisDrone tricycles).
Add one row after every fix or training run. Never edit old rows.

| Date (UTC+4) | Code version | Weights | Settings | Vehicle found / missed | Person found / missed | Bicycle found / missed | Motor found / missed | Wrong label |
|---|---|---|---|---|---|---|---|---|
| 2026-10-25 | main before fix (hard-coded class map) | yolov8n.pt (stock COCO) | full frame | 0 / 59 | 0 / 34 (labeled vehicle) | 0 / 8 | 0 / 26 | n/a |
| 2026-10-25 | edge-classes fix | yolov8n.pt (stock COCO) | full frame | 40 / 19 | 6 / 28 | 0 / 8 | 2 / 24 | 7 |
| 2026-10-25 | edge-classes fix | yolov8n.pt (stock COCO) | tiled | 43 / 16 | 17 / 17 | 0 / 8 | 3 / 23 | 8 |
| 2026-10-26 | edge-classes fix | /workspace/finetune/best_ep8.pt (interim: VisDrone train subset of 2500 images, best of first 8 of 60 epochs, CPU) | full frame | 48 / 11 | 13 / 21 | 0 / 8 | 2 / 24 | 7 |
| 2026-10-26 | edge-classes fix | /workspace/finetune/best_ep8.pt (interim, same as above) | tiled | 48 / 11 | 18 / 16 | 0 / 8 | 1 / 25 | 9 |
| 2026-10-28 | edge-classes fix | /workspace/finetune/best_final.pt (VisDrone train subset of 2500 images, best round 24 of 26, CPU, stopped by hand) | full frame | 48 / 11 | 12 / 22 | 0 / 8 | 8 / 18 | 7 |
| 2026-10-28 | edge-classes fix | /workspace/finetune/best_final.pt (same as above) | tiled | 50 / 9 | 13 / 21 | 0 / 8 | 9 / 17 | 6 |
| 2026-10-28 | class-conf-seams (per-class cutoff + tile seam fix) | yolov8n.pt (stock COCO) | full frame, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 5; bike boxes drawn: 3 | 40 / 19 | 6 / 28 | 1 / 7 | 2 / 24 | 7 |
| 2026-10-28 | class-conf-seams (per-class cutoff + tile seam fix) | yolov8n.pt (stock COCO) | full frame, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 5; bike boxes drawn: 3 | 40 / 19 | 6 / 28 | 1 / 7 | 2 / 24 | 7 |
| 2026-10-28 | class-conf-seams (per-class cutoff + tile seam fix) | yolov8n.pt (stock COCO) | tiled, seam fix, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 14; bike boxes drawn: 4 | 43 / 16 | 17 / 17 | 0 / 8 | 3 / 23 | 8 |
| 2026-10-28 | class-conf-seams (per-class cutoff + tile seam fix) | yolov8n.pt (stock COCO) | tiled, seam fix, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 14; bike boxes drawn: 5 | 43 / 16 | 17 / 17 | 0 / 8 | 3 / 23 | 8 |
| 2026-10-28 | class-conf-seams (per-class cutoff + tile seam fix) | /workspace/finetune/best_final.pt (same as above) | full frame, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 15; bike boxes drawn: 1 | 48 / 11 | 12 / 22 | 0 / 8 | 8 / 18 | 7 |
| 2026-10-28 | class-conf-seams (per-class cutoff + tile seam fix) | /workspace/finetune/best_final.pt (same as above) | full frame, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 15; bike boxes drawn: 8 | 48 / 11 | 12 / 22 | 1 / 7 | 8 / 18 | 7 |
| 2026-10-28 | class-conf-seams (per-class cutoff + tile seam fix) | /workspace/finetune/best_final.pt (same as above) | tiled, seam fix, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 56; bike boxes drawn: 5 | 50 / 9 | 13 / 21 | 0 / 8 | 9 / 17 | 6 |
| 2026-10-28 | class-conf-seams (per-class cutoff + tile seam fix) | /workspace/finetune/best_final.pt (same as above) | tiled, seam fix, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 56; bike boxes drawn: 19 | 50 / 9 | 13 / 21 | 1 / 7 | 9 / 17 | 7 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run1.pt (Kaggle hrishi98/hv-bike-run1 best.pt: YOLOv8n COCO base, full VisDrone2019-DET train+val to 4 classes, bike images 3x, the 10 eval frames and their val sequences held out, imgsz 1280, T4 GPU, 6.5 h cap reached after 58 of 60 epochs; kept outside the repo) | full frame, bike cutoff 0.25 (same as others); vehicle boxes on nothing: 5; bike boxes drawn: 3 | 49 / 10 | 20 / 14 | 1 / 7 | 11 / 15 | 5 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run1.pt (same as above) | full frame, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 5; bike boxes drawn: 4 | 49 / 10 | 20 / 14 | 1 / 7 | 11 / 15 | 5 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run1.pt (same as above) | full frame, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 5; bike boxes drawn: 5 | 49 / 10 | 20 / 14 | 1 / 7 | 11 / 15 | 5 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run1.pt (same as above) | full frame, image size 1280, bike cutoff 0.25 (same as others); vehicle boxes on nothing: 5; bike boxes drawn: 6 | 53 / 6 | 28 / 6 | 1 / 7 | 15 / 11 | 5 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run1.pt (same as above) | full frame, image size 1280, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 5; bike boxes drawn: 16 | 53 / 6 | 28 / 6 | 2 / 6 | 15 / 11 | 7 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run1.pt (same as above) | full frame, image size 1280, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 5; bike boxes drawn: 24 | 53 / 6 | 28 / 6 | 3 / 5 | 15 / 11 | 7 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run1.pt (same as above) | tiled, seam fix, bike cutoff 0.25 (same as others); vehicle boxes on nothing: 16; bike boxes drawn: 7 | 52 / 7 | 26 / 8 | 2 / 6 | 14 / 12 | 8 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run1.pt (same as above) | tiled, seam fix, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 16; bike boxes drawn: 11 | 52 / 7 | 26 / 8 | 3 / 5 | 14 / 12 | 9 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run1.pt (same as above) | tiled, seam fix, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 16; bike boxes drawn: 15 | 52 / 7 | 26 / 8 | 3 / 5 | 14 / 12 | 9 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run2.pt (Kaggle hrishi98/hv-bike-run2 best.pt: run 1 recipe plus 240 Sim PR #9 frames, 12% of train files, same hold-out, 6.5 h cap reached after 46 of 60 epochs; kept outside the repo) | full frame, bike cutoff 0.25 (same as others); vehicle boxes on nothing: 8; bike boxes drawn: 2 | 50 / 9 | 20 / 14 | 1 / 7 | 14 / 12 | 5 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run2.pt (same as above) | full frame, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 8; bike boxes drawn: 4 | 50 / 9 | 20 / 14 | 1 / 7 | 14 / 12 | 5 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run2.pt (same as above) | full frame, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 8; bike boxes drawn: 16 | 50 / 9 | 20 / 14 | 2 / 6 | 14 / 12 | 6 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run2.pt (same as above) | full frame, image size 1280, bike cutoff 0.25 (same as others); vehicle boxes on nothing: 9; bike boxes drawn: 3 | 51 / 8 | 27 / 7 | 1 / 7 | 15 / 11 | 3 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run2.pt (same as above) | full frame, image size 1280, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 9; bike boxes drawn: 7 | 51 / 8 | 27 / 7 | 2 / 6 | 15 / 11 | 3 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run2.pt (same as above) | full frame, image size 1280, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 9; bike boxes drawn: 16 | 51 / 8 | 27 / 7 | 3 / 5 | 15 / 11 | 4 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run2.pt (same as above) | tiled, seam fix, bike cutoff 0.25 (same as others); vehicle boxes on nothing: 18; bike boxes drawn: 5 | 49 / 10 | 27 / 7 | 3 / 5 | 16 / 10 | 6 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run2.pt (same as above) | tiled, seam fix, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 18; bike boxes drawn: 16 | 49 / 10 | 27 / 7 | 3 / 5 | 16 / 10 | 8 |
| 2026-10-31 | main a95dce9 (class-conf-seams, PR #6) | bike_run2.pt (same as above) | tiled, seam fix, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 18; bike boxes drawn: 33 | 49 / 10 | 27 / 7 | 4 / 4 | 16 / 10 | 9 |

Notes for the 2026-10-28 class-conf-seams rows:
- "Vehicle boxes on nothing" (vehicle boxes that match no labeled object) is a new count, first measured in these rows; older rows did not record it. The seam fix lowers it in tiled mode (stock 26 to 14, best_final 80 to 56 at the same cutoffs).
- Bike precision caveat: a low bike cutoff finds at most 1 of 8 bikes and adds many wrong bike boxes. At 0.05, best_final tiled draws 19 bike boxes with 1 correct. The bike cutoff is not a fix on its own; bikes need GPU training with more bike examples.

Notes for the 2026-10-31 bike run rows:
- Both bike runs were trained on a Kaggle T4 GPU (kernels hrishi98/hv-bike-run1 and hrishi98/hv-bike-run2). Rows were measured on this box with eval10.py matching (ev.py with extra counts). A fresh rerun on 2026-10-31 gave identical numbers.
- Bikes are still the weak spot. With the normal 0.25 cutoff, both runs find 1 of 8 bikes on full 640 frames. Tiled, run 1 finds 2 and run 2 finds 3 (5 bike boxes drawn). Run 2 tiled at a 0.05 bike cutoff finds 4 of 8 but draws 33 bike boxes, so most are wrong.
- Compared with best_final (CPU, 2500 images), people tiled rose from 13 to 26 (run 1) and 27 (run 2), and motor tiled from 9 to 14 and 16. Image size 1280 on full frames gives similar people and vehicle counts to tiling with fewer vehicle boxes on nothing (5 to 9 against 16 to 18).
- Run 2's Sim frames did not clearly beat run 1: tiled, run 2 has +1 bike, +1 person, +2 motor and -3 vehicle.
