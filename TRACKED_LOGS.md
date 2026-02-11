# VerseCon Link - Tracked Log Patterns

This document lists the regex patterns used by the Log Engine to track game state.

## Phase 1: Core (Implemented & Verified)

### Navigation (`navigation.js`)

- **Quantum Jump**: `<Jump Drive Requesting State Change>.*to Traveling`
- **Quantum Exit**: `<Jump Drive Requesting State Change>.*to Idle`
- **Location**: `Location\[(.*?)\]`

### Vehicle (`vehicle.js`)

- **Seat Enter**: `<Vehicle Control Flow>.*Enter Seat`
- **Seat Exit**: `<Vehicle Control Flow>.*Exit Seat`
- **Spawn**: `GenerateLocationProperty.*locations: \((.*?) \[(\d+)\]`

### Combat (`combat.js`)

- **Death**: `<Actor Death>.*killed by \[(.*?)\]`

---

## Phase 2: Industrial (DRAFT - Needs Verification)

> [!WARNING]
> These patterns are speculative and based on standard SC log formats. They need verification against actual `Game.log` files from mining/salvage sessions.

### Mining (`mining.js`)

- **Laser Active**: `<MiningLaser::SetLaserActive>.*Active\[(\d)\]`
- **Fracture**: `<MiningFracture::OnFracture>.*Success\[(\d)\]`
- **Extraction**: `<MiningExtraction::OnExtraction>.*Amount\[([\d\.]+)\]`

### Salvage (`salvage.js`)

- **Beam Active**: `<SalvageBeam::SetBeamActive>.*Active\[(\d)\]`
- **Material Scrape**: `<SalvageMaterial::OnScrape>.*Amount\[([\d\.]+)\] Type\[(.*?)\]`

### Engineering (`engineering.js`)

- **Power State**: `<PowerPlant::SetState>.*State\[(.*?)\]`
- **Fuse Break**: `<Fuse::OnBreak>.*Room\[(.*?)\] ID\[(.*?)\]`
