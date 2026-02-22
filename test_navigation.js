const NavigationParser = require('./src/main/parsers/navigation');

const parser = NavigationParser;

parser.on('gamestate', (data) => {
    console.log(`[EMIT] type: ${data.type}, value: ${data.value}`);
});

console.log('--- Testing Freight Elevator ---');
parser.parse('<2026-02-21T01:18:20.283Z> [Notice] <CSCLoadingPlatformManager::OnLoadingPlatformStateChanged> [Loading Platform] Loading Platform Manager [LoadingPlatformManager_FreightElevator_Util_HangarXL] Platform state changed to OpenIdle');

console.log('\n--- Testing Valid Outpost ---');
parser.parse('<2026-02-21T01:18:20.283Z> [Notice] <CSCLoadingPlatformManager::OnLoadingPlatformStateChanged> [Loading Platform] Loading Platform Manager [LoadingPlatformManager_Brios_Breaker_Yard] Platform state changed to OpenIdle');

console.log('\n--- Testing Quantum Spooling ---');
parser.parse('<2026-02-21T01:21:50.391Z> [Notice] <Player Selected Quantum Target - Local>');

console.log('\n--- Testing Zones with Custom Location ---');
parser.setCustomLocations({
    'OOC_Stanton_2b_Daymar': { name: 'Daymar HQ', zone: 'Armistice Zone' },
    'OOC_Stanton_4_MicroTech': 'MicroTech Surface'
});

console.log('\n--- Testing System Detection (Stanton) ---');
parser.parse('<2026-02-21T01:21:50.391Z> [Notice] <GenerateLocationProperty> Generated Locations - Location[OOC_Stanton_4_MicroTech]');

console.log('\n--- Testing System Detection (Pyro) ---');
parser.parse('<2026-02-21T01:21:50.391Z> [Notice] <GenerateLocationProperty> Generated Locations - Location[OOC_Pyro_2_Aki]');

console.log('\n--- Testing Generated Locations (Mission Caves) ---');
parser.parse('<2026-02-21T02:17:06.547Z> [Notice] <GenerateLocationProperty> Generated Locations - variablename: SubLocationType_BP, locations: (Hurston Cave [3018817963] [Cave_Unoccupied_Stanton1]) contract: CleanAir_DefendShip_Hard_1 [Team_MissionFeatures][Missions]');

