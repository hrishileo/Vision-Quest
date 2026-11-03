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
| 2026-11-03 | main d58c3d7 (detector code unchanged since a95dce9) | bike_run3.pt (Kaggle hrishi98/hv-bike-run3 best.pt: run 2 recipe with the 240 Sim PR #9 frames swapped for 384 Sim PR #11 frames, 12.5% of train files, same hold-out, 6.5 h cap reached after 49 of 60 epochs; kept outside the repo) | full frame, bike cutoff 0.25 (same as others); vehicle boxes on nothing: 4; bike boxes drawn: 2 | 50 / 9 | 19 / 15 | 1 / 7 | 15 / 11 | 6 |
| 2026-11-03 | main d58c3d7 (detector code unchanged since a95dce9) | bike_run3.pt (same as above) | full frame, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 4; bike boxes drawn: 3 | 50 / 9 | 19 / 15 | 1 / 7 | 15 / 11 | 6 |
| 2026-11-03 | main d58c3d7 (detector code unchanged since a95dce9) | bike_run3.pt (same as above) | full frame, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 4; bike boxes drawn: 13 | 50 / 9 | 19 / 15 | 2 / 6 | 15 / 11 | 7 |
| 2026-11-03 | main d58c3d7 (detector code unchanged since a95dce9) | bike_run3.pt (same as above) | full frame, image size 1280, bike cutoff 0.25 (same as others); vehicle boxes on nothing: 9; bike boxes drawn: 3 | 51 / 8 | 26 / 8 | 0 / 8 | 13 / 13 | 7 |
| 2026-11-03 | main d58c3d7 (detector code unchanged since a95dce9) | bike_run3.pt (same as above) | full frame, image size 1280, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 9; bike boxes drawn: 11 | 51 / 8 | 26 / 8 | 2 / 6 | 13 / 13 | 8 |
| 2026-11-03 | main d58c3d7 (detector code unchanged since a95dce9) | bike_run3.pt (same as above) | full frame, image size 1280, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 9; bike boxes drawn: 15 | 51 / 8 | 26 / 8 | 2 / 6 | 13 / 13 | 8 |
| 2026-11-03 | main d58c3d7 (detector code unchanged since a95dce9) | bike_run3.pt (same as above) | tiled, seam fix, bike cutoff 0.25 (same as others); vehicle boxes on nothing: 11; bike boxes drawn: 7 | 52 / 7 | 26 / 8 | 2 / 6 | 15 / 11 | 7 |
| 2026-11-03 | main d58c3d7 (detector code unchanged since a95dce9) | bike_run3.pt (same as above) | tiled, seam fix, bike cutoff 0.10 (others 0.25); vehicle boxes on nothing: 11; bike boxes drawn: 12 | 52 / 7 | 26 / 8 | 2 / 6 | 15 / 11 | 7 |
| 2026-11-03 | main d58c3d7 (detector code unchanged since a95dce9) | bike_run3.pt (same as above) | tiled, seam fix, bike cutoff 0.05 (others 0.25); vehicle boxes on nothing: 11; bike boxes drawn: 30 | 52 / 7 | 26 / 8 | 4 / 4 | 15 / 11 | 8 |

Notes for the 2026-10-28 class-conf-seams rows:
- "Vehicle boxes on nothing" (vehicle boxes that match no labeled object) is a new count, first measured in these rows; older rows did not record it. The seam fix lowers it in tiled mode (stock 26 to 14, best_final 80 to 56 at the same cutoffs).
- Bike precision caveat: a low bike cutoff finds at most 1 of 8 bikes and adds many wrong bike boxes. At 0.05, best_final tiled draws 19 bike boxes with 1 correct. The bike cutoff is not a fix on its own; bikes need GPU training with more bike examples.

Notes for the 2026-10-31 bike run rows:
- Both bike runs were trained on a Kaggle T4 GPU (kernels hrishi98/hv-bike-run1 and hrishi98/hv-bike-run2). Rows were measured on this box with eval10.py matching (ev.py with extra counts). A fresh rerun on 2026-10-31 gave identical numbers.
- Bikes are still the weak spot. With the normal 0.25 cutoff, both runs find 1 of 8 bikes on full 640 frames. Tiled, run 1 finds 2 and run 2 finds 3 (5 bike boxes drawn). Run 2 tiled at a 0.05 bike cutoff finds 4 of 8 but draws 33 bike boxes, so most are wrong.
- Compared with best_final (CPU, 2500 images), people tiled rose from 13 to 26 (run 1) and 27 (run 2), and motor tiled from 9 to 14 and 16. Image size 1280 on full frames gives similar people and vehicle counts to tiling with fewer vehicle boxes on nothing (5 to 9 against 16 to 18).
- Run 2's Sim frames did not clearly beat run 1: tiled, run 2 has +1 bike, +1 person, +2 motor and -3 vehicle.

Notes for the 2026-11-03 bike run 3 rows:
- Trained on a Kaggle T4 GPU (kernel hrishi98/hv-bike-run3) with run 2's settings and Docker image. The only change is the Sim set: 384 frames from Sim PR #11 instead of 240 from PR #9, repeated so Sim stays about 12.5% of train files (run 2: 12.3%). Measured on this box with the same eval10.py matching as run 2.
- Run 3 does not beat run 2 on people or bikes. People are 1 lower in every setting (tiled 26 against 27, full 1280 26 against 27, full 640 19 against 20). Bikes at the 0.25 cutoff: tiled 2 against 3, full 1280 0 against 1, full 640 1 against 1. Tiled at 0.05 both runs find 4 of 8 bikes (run 3 draws 30 bike boxes, run 2 33).
- Vehicles improved: tiled finds 52 against 49 with 11 vehicle boxes on nothing against 18; full 640 has 4 boxes on nothing against 8. Motor tiled is 15 against 16.
- Kaggle validation mAP50 (200 held-out val images) is 0.618 for run 3 against 0.626 for run 2; bicycle mAP50 0.298 against 0.316.

Note added 2026-11-03 (weights split, Jarvis's decision after the run 3 diagnosis):
- Vehicle and lane events use run 3 weights (bike_run3.pt). Person and bicycle detection stays on run 2 weights (bike_run2.pt). Each job loads its own model.
- Why run 3 for vehicles: it draws fewer vehicle boxes on nothing, the error that can close a lane or fire a reroute for drivers. Tiled it drops from 18 (run 2) to 11, and on full frames at 640 px from 8 to 4, while finding as many or more vehicles (tiled 52 against 49 of 59).
- Why run 2 stays for people and bikes: run 3 is 1 person and up to 1 bike lower, and the misses are explained by a mismatch between the test frames and the Sim data, not by the training setup. 7 of the 8 test bikes are parked with no rider, while every sampled Sim bike has a rider and is smaller (about 15 px against about 38 px for the missed real bikes). Most missed people are riders that VisDrone labels as their own person box, but the model merges the rider into the bicycle or motor box. Sim frames made no measurable difference to people (tiled 26, 27, 26 for runs 1, 2, 3; run 1 had no Sim frames).
- With 8 bikes and 34 people in the 10-frame set, one object decides a result. The larger held-out test set rows below are the check on this split.
