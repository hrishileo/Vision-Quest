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

Notes for the 2026-10-28 class-conf-seams rows:
- "Vehicle boxes on nothing" (vehicle boxes that match no labeled object) is a new count, first measured in these rows; older rows did not record it. The seam fix lowers it in tiled mode (stock 26 to 14, best_final 80 to 56 at the same cutoffs).
- Bike precision caveat: a low bike cutoff finds at most 1 of 8 bikes and adds many wrong bike boxes. At 0.05, best_final tiled draws 19 bike boxes with 1 correct. The bike cutoff is not a fix on its own; bikes need GPU training with more bike examples.
