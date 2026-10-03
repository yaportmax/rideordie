# Historical pre-Hummer oracles

These fixtures are tracked test inputs. They are held snapshots of the public three-family implementation taken before Hummer integration, rather than imports from ignored `work/` paths or copies of the new Hummer implementation. Their purpose is to catch unintended changes to legacy bought geometry and cloud canonical bytes.

Original source SHA256 values:

- `src/view/car_upgrade_mounts.js`: `7DE8D27E428317C95B11E9D5EF8859A9578F9A88377D6C8FE290FEEF11132EEF`
- `src/view/car_upgrade_plan.js`: `BF3837B1BA15936024A1AF2AE51F95F1E37F79C70C300C44EE91EBC412B02F7C`
- `server/saves/schema.js`: `9431D859FF8E57381B59B9AB95084476694817B1C9D14A91E9E4A3E55EB80EAA`

The mount and schema snapshots only add a provenance comment. The plan snapshot replaces its live family-module import with the exact historical global cap table: engine/armor/tires/nitro 5, ram 3, spikes/glass/fueltank/oil/mines 2. This makes the oracle independent of later family-policy edits. Its historical authored geometry algorithm is retained.

The legacy geometry comparison covers all nine existing player models, empty levels, every individual paid level, and all capped levels together. It still supplies the current legacy model metadata to both algorithms, matching the original WORK comparison's scope; it does not freeze every historical GLB, prove native pixels, or prove metadata unchanged. The existing literal catalogue and binary identity tests separately retain the old costs and 23 spec indices.

The legacy wire snapshot retains the three old families and nine original truck IDs. Its profile sanitizer is used as an independent expected projection for old saves and their canonical SHA256 content. It is not used by production CloudSaves, SaveStore or the Worker.

Keep these snapshots held when production code changes. Do not refresh them just to make a regression pass. A deliberate new legacy behavior requires a separately justified oracle update.
