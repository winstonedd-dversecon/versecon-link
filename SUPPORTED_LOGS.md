# Supported Log Patterns in VerseCon Link

## COMBAT Parser

- **actor_death**: /<Actor Death>/
- **actor_state_dead**: /<\[ActorState\] Dead>.*?Actor '([^']+)'\s*\[\d+\].*?from zone '([^']+)'\s*\[\d+\].*?to zone '([^']+)'/i
- **death_detailed**: /<Actor Death>.*?'([^']+)'\s*\[\d+\].*?killed by\s+'([^']+)'\s*\[\d+\].*?using\s+'([^']+)'.*?damage type\s+'([^']+)'/i
- **death_zone**: /in zone\s+'([^']+)'/i
- **death_direction**: /from direction\s+x:\s*([-\d.]+),?\s*y:\s*([-\d.]+),?\s*z:\s*([-\d.]+)/i
- **crimestat**: /CrimeStat Rating (Increased|Decreased)/i
- **medical_dropoff**: /DropoffLocation_BP\[Destination\],\s+locations:\s+\(([^\]]+)\s+\[([^\]]+)\]\)/i
- **vehicle_destruction**: /<Vehicle Destruction>/
- **vehicle_destruction_detail**: /<Vehicle Destruction>.*?Vehicle\s+'([^']+)'\s*\[\d+\].*?driven by\s+'([^']+)'\s*\[\d+\].*?from destroy level\s+(\d+)\s+to\s+(\d+).*?caused by\s+'([^']+)'/i
- **vehicle_destruction_zone**: /in zone\s+'([^']+)'/i
- **suffocating**: /Player.*started suffocating/i
- **depressurizing**: /Player.*started depressurization/i
- **fire_actual**: /<Fire Client - Snapshot Request> Fire Area '([^']+)' requested an up-to-date fire grid snapshot.*Similarity: [\d.]+ dB/i
- **fire_notification**: /Added notification.*(?:Fire|fire)/i

## ECONOMY Parser

- **transaction**: /<Transaction>/
- **shop_purchase**: /<ShopPurchase>/
- **insurance_claim**: /<InsuranceClaim>/
- **fine**: /Fined\s+(\d+)\s+UEC/i

## ENGINEERING Parser

- **power_state**: /<PowerPlant::SetState>/
- **cooler_temp**: /<Cooler::OnTemperatureChange>/
- **fuse_break**: /<Fuse::OnBreak>/

## HANGAR Parser

- **platform_state**: /<CSCLoadingPlatformManager::TransitionLightGroupState>.*platform manager '([^']+)'.*state:\s+(\w+)/i
- **atc_assigned**: /Notification "Landing pad ([^"]+) assigned"/i

## INVENTORY Parser


## MINING Parser

- **laser_activation**: /<MiningLaser::SetLaserActive>/
- **fracture_event**: /<MiningFracture::OnFracture>/
- **extraction_event**: /<MiningExtraction::OnExtraction>/
- **material_modifier**: /<MaterialModifier>/

## MISSION Parser

- **mission_ended_structured**: /<MissionEnded>\s*mission_id\s*\[([^\]]+)\]\s*-\s*mission_state\s*\[([^\]]+)\]/i
- **mission_ended_tag**: /<MissionEnded>/
- **mission_objective_tag**: /<ObjectiveUpserted>/
- **contract_accepted**: /Added notification "Contract Accepted:\s*([^"]+)"/i
- **contract_complete**: /Added notification "Contract Complete[d]?:\s*([^"]+)"/i
- **contract_failed**: /Added notification "Contract Failed:\s*([^"]+)"/i
- **new_objective**: /Added notification "New Objective:\s*([^"]+)"/i
- **mobiglas_accept**: /MobiGlas::OnAcceptMission/i
- **notification_mission_id**: /MissionId:\s*\[([^\]]+)\]/i
- **notification_objective_id**: /ObjectiveId:\s*\[([^\]]*)\]/i
- **tracked_mission**: /TrackedMission|MissionMarker/i

## NAVIGATION Parser

- **location_inventory**: /<RequestLocationInventory>\s+Player\[[^\]]+\]\s+requested inventory for Location\[([^\]]+)\]/i
- **stamina_room_ooc**: /\[STAMINA\]\s+(?:\\t)?->\s*RoomName:\s*(OOC_[^\s]+)/i
- **room_name**: /RoomName:\s*([^\s]+)/i
- **join_pu**: /<Join PU>\s+address\[([^\]]+)\]\s+port\[([^\]]+)\]\s+shard\[([^\]]+)\]/i
- **jurisdiction**: /Added notification "Entered\s+(.*?)\s*Jurisdiction/i
- **monitored_space**: /Added notification "Entered Monitored Space/i
- **armistice_enter**: /Added notification "Entering Armistice Zone/i
- **armistice_leave**: /Added notification "Leaving Armistice Zone/i
- **location_generic**: /Location\[([^\]]+)\]/i
- **location_obj**: /<StatObjLoad\s+0x[0-9A-Fa-f]+\s+Format>\s+'[^']*?objectcontainers\/pu\/loc\/(?:flagship|mod)\/(?:stanton\/)?(?:station\/ser\/)?(?:[^\/]+\/)*([^\/]{5,})\//i
- **quantum_entered**: /<Jump Drive Requesting State Change>.*to Traveling/
- **quantum_exited**: /<Jump Drive Requesting State Change>.*to Idle/
- **quantum_arrived**: /<Quantum Drive Arrived/
- **interdiction**: /Interdiction/i
- **loading_platform**: /\[LoadingPlatformManager_([^\]]+)\]\s+Platform state changed/i
- **ocs_master_zone**: /Master zone is \[([^\]]+)\]/i

## SALVAGE Parser

- **beam_activation**: /<SalvageBeam::SetBeamActive>/
- **material_scrape**: /<SalvageMaterial::OnScrape>/
- **rmc_collection**: /<Salvage::OnRMCCollected>/

## SESSION Parser

- **log_start**: /^<([^>]+)> Log started on/i
- **build_info**: /Build\((\d+)\)/i
- **environment**: /\[Trace\] Environment:\s+(\w+)/i
- **session_id**: /\[Trace\] @session:\s+'([^']+)'/i
- **system_quit**: /<SystemQuit>\s+CSystem::Quit invoked/i

## SOCIAL Parser

- **social_subscribe**: /SubscribeToPlayerSocial:\s*([^\s]+)/
- **group_invite**: /<Group>.*Invite/i
- **group_join**: /<Group>.*Join/i

## VEHICLE Parser

- **voip_join**: /You have joined channel '(.+?)\s*:\s*[^']+'/
- **clear_driver**: /ClearDriver.*releasing control token for '([^']+)'/
- **hangar_state**: /LoadingPlatformManager.*?ShipElevator.*?Platform state changed to (\w+)/i
- **spawn_flow**: /<Spawn Flow>/
- **spawn_reservation**: /lost\s+reservation\s+for\s+spawnpoint\s+([^\s]+)\s+\[(\d+)\]/
- **asop_access**: /Fetching ship list for local client\s+\[Team_GameServices\]\[ASOP\]/i

## ZONE Parser

- **armistice_enter**: /Notification "You have entered an Armistice Zone"/i
- **armistice_leave**: /Notification "You have left an Armistice Zone"/i
- **monitored_enter**: /Notification "Entered Monitored Space"/i
- **monitored_leave**: /Notification "Left Monitored Space"/i
- **ruleset_armistice_enter**: /<RulesetManager>.*Entered Armistice Zone/i
- **ruleset_armistice_leave**: /<RulesetManager>.*Left Armistice Zone/i

