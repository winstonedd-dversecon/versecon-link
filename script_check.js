
        const { ipcRenderer } = require('electron');

        // ═══ STATE ═══
        let soundEnabled = true;
        let soundVolume = 0.7;
        let unknownCount = 0;
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // ═══ TAB SWITCHING ═══
        function switchTab(tab) {
            document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));

            document.getElementById(`nav-${tab}`).classList.add('active');
            document.getElementById(`view-${tab}`).classList.add('active');

            // Update header title
            const titles = {
                'dashboard': ['Dashboard', 'Live system telemetry and mission feed'],
                'vcon': ['VerseCon Feed', 'Platform-wide contracts, beacons and trades'],
                'command': ['Command Console', 'Battlefield C2 and quick orders'],
                'config': ['Settings', 'Application configuration and log patterns'],
                'players': ['Social Hub', 'Manage friends and shared telemetry'],
                'logdb': ['Log Database', 'Known Star Citizen log patterns — browse, edit, export']
            };

            // Auto-load patterns when switching to logdb
            if (tab === 'logdb') loadPatternDB();

            if (titles[tab]) {
                document.getElementById('view-title').innerText = titles[tab][0];
                document.getElementById('view-subtitle').innerText = titles[tab][1];
            }
        }

        // ═══ SOUND SYSTEM (v3 Synthesizer) ═══
        function playSound(type) {
            if (!soundEnabled) return;
            try {
                const volElem = document.getElementById('sound-volume');
                const vol = (volElem ? volElem.value : 50) / 100;

                if (window.audioSynth) {
                    window.audioSynth.setVolume(vol);
                    window.audioSynth.play(type);
                }
            } catch (e) {
                console.warn('Sound failed:', e);
            }
        }

        function toggleSounds() {
            soundEnabled = document.getElementById('sound-enabled').checked;
            saveConfig();
        }

        function updateVolume() {
            soundVolume = document.getElementById('sound-volume').value / 100;
            saveConfig();
        }

        // ═══ CONFIG MANAGEMENT ═══
        function saveConfig() {
            const config = {
                logPath: document.getElementById('config-log-path').value,
                volume: document.getElementById('sound-volume').value,
                soundEnabled: document.getElementById('sound-enabled').checked,
                // overlayEnabled if exists
                shareLocation: document.getElementById('config-share-location').checked
            };
            // Handle optional elements
            const overlayEl = document.getElementById('config-overlay-enabled');
            if (overlayEl) config.overlayEnabled = overlayEl.checked;

            const autoCleanEl = document.getElementById('config-auto-clean');
            if (autoCleanEl) config.autoCleanMissions = autoCleanEl.checked;

            ipcRenderer.send('settings:save', config);
        }

        ipcRenderer.on('settings:updated', (e, config) => {
            // Update UI from config
            if (config.volume) document.getElementById('sound-volume').value = config.volume;
            if (config.soundEnabled !== undefined) document.getElementById('sound-enabled').checked = config.soundEnabled;
            if (config.shareLocation !== undefined) document.getElementById('config-share-location').checked = config.shareLocation;

            // Update local state
            soundVolume = (config.volume || 70) / 100;
            soundEnabled = config.soundEnabled !== false;
        });

        // Request initial config?
        // dashboardWindow.webContents.send('settings:load', config) call in main.js creation would be better.
        // For now, we rely on local state or defaults.


        // ═══ FEED HELPERS ═══
        function addFeedItem(feedId, icon, text) {
            const feed = document.getElementById(feedId);
            const time = new Date().toLocaleTimeString([], { hour12: false });
            const item = document.createElement('div');
            item.className = 'feed-item';
            item.innerHTML = `
                <span class="feed-time">${time}</span>
                <span class="feed-icon">${icon}</span>
                <span class="feed-text">${text}</span>
            `;
            feed.prepend(item);
            if (feed.children.length > 150) feed.lastElementChild.remove();
        }

        function addDashItem(icon, text) { addFeedItem('event-feed', icon, text); }
        function addVconItem(icon, text) { addFeedItem('vcon-feed', icon, text); }

        // ═══ AUTH ═══
        function openLogin() {
            console.log('[Dashboard] openLogin clicked!');
            // v2.2 - Use custom protocol redirect
            ipcRenderer.invoke('app:open-external', 'https://versecon.space/api/auth/discord/login?redirect=versecon-link://auth').then(() => {
                addDashItem('🔑', 'Opening browser... Please login.');
            }).catch(err => {
                addDashItem('❌', 'Failed to open browser: ' + err.message);
            });
        }

        function loginManual() {
            const token = document.getElementById('api-token-manual').value;
            if (token) {
                ipcRenderer.send('app:login', token);
                document.getElementById('auth-ui-guest').style.display = 'none';
                document.getElementById('auth-ui-user').style.display = 'block';
                addDashItem('🔒', 'Manual token set.');
            }
        }

        function confirmClearDb() {
            if (confirm("Are you sure you want to permanently delete all logs from the database?\nThis action cannot be undone.")) {
                ipcRenderer.send('logdb:clear');
            }
        }

        // ═══ NEW LOCATION TOAST LOGIC ═══
        function showNewLocationToast(displayName, rawName) {
            let container = document.getElementById('toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toast-container';
                container.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:10px; pointer-events:none;';
                document.body.appendChild(container);
            }

            const toast = document.createElement('div');
            toast.style.cssText = `
                background: rgba(11, 12, 16, 0.95);
                border: 1px solid var(--accent);
                border-left: 4px solid var(--accent);
                border-radius: 6px;
                padding: 12px 16px;
                color: white;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5), 0 0 10px rgba(255,165,0,0.2);
                backdrop-filter: blur(10px);
                font-family: 'Rajdhani', sans-serif;
                min-width: 280px;
                animation: slideIn 0.3s ease forwards;
                pointer-events: auto;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
            `;

            toast.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <div style="font-weight:700; color:var(--accent); font-size:0.9rem; text-transform:uppercase; letter-spacing:1px;">📍 New Location Detected</div>
                    <button onclick="event.stopPropagation(); this.parentElement.parentElement.remove()" style="background:none; border:none; color:#888; cursor:pointer; font-size:1.2rem; padding:0; line-height:1;">&times;</button>
                </div>
                <div style="font-size:0.95rem; margin-bottom:6px;">${escapeHtml(displayName)}</div>
                <div style="font-size:0.75rem; color:var(--text-dim);">Click to map a custom name</div>
            `;

            toast.onmouseenter = () => {
                toast.style.transform = 'translateY(-2px)';
                toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.6), 0 0 15px rgba(255,165,0,0.4)';
            };
            toast.onmouseleave = () => {
                toast.style.transform = 'translateY(0)';
                toast.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5), 0 0 10px rgba(255,165,0,0.2)';
            };

            toast.onclick = () => {
                // Switch to Settings Tab
                switchTab('config');

                // Populate the Custom Locations form
                const keyInput = document.getElementById('new-loc-key');
                const valInput = document.getElementById('new-loc-val');

                if (keyInput && valInput) {
                    keyInput.value = rawName || displayName;
                    valInput.value = '';
                    valInput.focus();

                    // Highlight the form briefly
                    const formContainer = keyInput.closest('div[style*="background: rgba(0,0,0,0.3)"]'); // This selector might need adjustment based on actual HTML structure
                    if (formContainer) {
                        const originalBg = formContainer.style.background;
                        formContainer.style.background = 'rgba(255, 165, 0, 0.2)';
                        formContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        setTimeout(() => formContainer.style.background = originalBg, 1000);
                    }
                }
                toast.remove();
            };

            container.appendChild(toast);

            // Auto-remove after 10 seconds
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateX(20px)';
                    toast.style.transition = 'opacity 0.3s, transform 0.3s';
                    setTimeout(() => toast.remove(), 300);
                }
            }, 10000);
        }

        function toggleOverlay() { ipcRenderer.send('app:toggle-overlay'); }

        function selectLogFile() {
            ipcRenderer.invoke('app:select-log').then(path => {
                if (path) {
                    document.getElementById('config-log-path').value = path;
                    addDashItem('⚙️', `Log path set: ${path}`);
                }
            });
        }

        // ═══ COMMAND MODULE ═══
        function sendPresetCommand(preset) {
            const target = document.getElementById('cmd-target').value;
            const data = {
                preset,
                target,
                fromTeam: config.userTeam || 'Alpha',
                timestamp: Date.now()
            };
            ipcRenderer.send('command:send', data);
            addCommandLog(preset, target, 'YOU');
            playSound(preset === 'EMERGENCY' ? 'sos' : 'command');
        }

        function sendCustomCommand() {
            const text = document.getElementById('cmd-custom-text').value.trim();
            if (!text) return;
            const target = document.getElementById('cmd-target').value;
            const broadcast = document.getElementById('cmd-broadcast').checked;
            const data = {
                text,
                target,
                fromTeam: config.userTeam || 'Alpha',
                broadcast,
                timestamp: Date.now()
            };
            ipcRenderer.send('command:send', data);
            addCommandLog(text, target, 'YOU');
            document.getElementById('cmd-custom-text').value = '';
            playSound('command');
        }

        function addCommandLog(text, target, from) {
            const log = document.getElementById('command-log');
            // Remove placeholder
            const placeholder = log.querySelector('div[style]');
            if (placeholder && placeholder.textContent.includes('No commands')) placeholder.remove();

            const time = new Date().toLocaleTimeString([], { hour12: false });
            const item = document.createElement('div');
            item.className = 'cmd-log-item';
            item.innerHTML = `
                <div class="cmd-log-from">${time} — FROM: ${from}</div>
                <div class="cmd-log-text">${text}</div>
                <div class="cmd-log-target">→ ${target}</div>
                <div class="cmd-log-ack" id="ack-${Date.now()}">⏳ Awaiting ACK...</div>
            `;
            log.prepend(item);
        }

        // ═══ SHIP IMAGE MANAGER (v2.2) ═══
        let shipMap = {};

        function loadShipMap() {
            ipcRenderer.invoke('settings:get-ship-map').then(map => {
                shipMap = map || {};
                renderShipMapList();
            });
        }

        function renderShipMapList() {
            const list = document.getElementById('ship-map-list');
            if (Object.keys(shipMap).length === 0) {
                list.innerHTML = '<div style="padding: 10px; font-style: italic; color: #555; text-align: center;">No mappings set.</div>';
                return;
            }
            list.innerHTML = Object.entries(shipMap).map(([name, path]) => `
                <div class="map-item" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div style="flex: 1;">
                        <span style="color: var(--accent); font-weight: bold;">${name}</span>
                        <div style="font-size: 0.7rem; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;">${path}</div>
                    </div>
                    <button class="cyber-btn small danger" onclick="removeShipMapping('${name}')" style="margin:0; padding: 2px 8px;">×</button>
                </div>
            `).join('');
        }

        function selectNewShipImage() {
            ipcRenderer.invoke('app:select-ship-image').then(path => {
                if (path) {
                    document.getElementById('new-ship-image-path').value = path;
                    document.getElementById('new-ship-filename').textContent = path.split(/[\\\\/]/).pop();
                    document.getElementById('new-ship-preview-label').style.display = 'block';
                }
            });
        }

        function addShipMapping() {
            const name = document.getElementById('new-ship-name').value.trim();
            const path = document.getElementById('new-ship-image-path').value;

            if (!name) return alert('Please enter a ship name.');
            if (!path) return alert('Please select an image.');

            shipMap[name] = path;
            saveShipMap();

            // Clear inputs
            document.getElementById('new-ship-name').value = '';
            document.getElementById('new-ship-image-path').value = '';
            document.getElementById('new-ship-preview-label').style.display = 'none';
            renderShipMapList();
        }

        function removeShipMapping(name) {
            delete shipMap[name];
            saveShipMap();
            renderShipMapList();
        }

        function saveShipMap() {
            ipcRenderer.invoke('settings:save-ship-map', shipMap);
        }

        // ═══ DETECTED SHIP HELPER ═══
        let lastDetectedShip = null;
        ipcRenderer.on('settings:last-ship', (e, shipName) => {
            if (!shipName) return;
            lastDetectedShip = shipName;
            const label = document.getElementById('detected-ship-label');
            if (label) {
                label.innerHTML = `Detected: <strong style="color:var(--accent)">${shipName}</strong> <a href="#" onclick="useDetectedShip('${shipName}')" style="font-size:0.8em; margin-left:10px">[USE THIS]</a>`;
                label.style.display = 'block';
            }
        });

        window.useDetectedShip = (name) => {
            document.getElementById('new-ship-name').value = name;
        };

        // Mission Renaming
        window.renameCurrentMission = async () => {
            if (!window.currentMissionId) {
                // If no ID, try to rename current 'active' if main.js logic allows, or alert
                alert('No active Mission ID tracked. Accept a contract first.');
                return;
            }
            const currentName = document.getElementById('mission-title').innerText;
            const newName = await window.vcModal.prompt('Rename Mission', `Enter name for ID ${window.currentMissionId}:`, currentName);

            if (newName && newName !== currentName) {
                ipcRenderer.send('mission:rename', { id: window.currentMissionId, name: newName });
            }
        };

        // Initialize (called after ipcRenderer ready? No, call directly here, assuming early enough)
        loadShipMap();


        // ═══ MANUAL PATTERNS (v2.2) ═══
        let customPatterns = [];

        function loadCustomPatterns() {
            ipcRenderer.invoke('settings:get-custom-patterns').then(patterns => {
                customPatterns = patterns || [];
                renderPatternList();
            });
        }

        function renderPatternList() {
            const list = document.getElementById('pattern-list');
            if (customPatterns.length === 0) {
                list.innerHTML = '<div style="padding: 10px; font-style: italic; color: #555; text-align: center;">No custom patterns defined.</div>';
                return;
            }
            list.innerHTML = customPatterns.map((p, i) => `
                <div class="map-item" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div style="flex: 1; overflow: hidden;">
                        <div style="font-family: monospace; color: var(--accent); font-size: 0.8rem;">${escapeHtml(p.regex)}</div>
                        <div style="font-size: 0.7rem; color: #888;">
                            <span style="font-weight:bold; color: ${getColorForLevel(p.level)}">${p.level}</span> ${escapeHtml(p.message)}
                            ${p.hueColor ? ` • <span style="color:#aa88ff;">HUE: ${p.hueColor.toUpperCase()}</span>` : ''}
                        </div>
                    </div>
                    <button class="cyber-btn small danger" onclick="removeCustomPattern(${i})" style="margin:0; padding: 2px 8px;">×</button>
                </div>
            `).join('');
        }

        function getColorForLevel(level) {
            switch (level) {
                case 'INFO': return '#4FC3F7';
                case 'WARN': return '#FFA726';
                case 'CRITICAL': return '#FF5252';
                default: return '#eee';
            }
        }

        function addCustomPattern() {
            const regex = document.getElementById('new-pattern-regex').value.trim();
            const level = document.getElementById('new-pattern-level').value;
            const message = document.getElementById('new-pattern-msg').value.trim();
            const hueColor = document.getElementById('new-pattern-hue').value;

            if (!regex) return alert('Please enter a Regex pattern.');
            if (!message) return alert('Please enter an alert message.');

            // Validate Regex
            try {
                new RegExp(regex);
            } catch (e) {
                return alert('Invalid Regex: ' + e.message);
            }

            customPatterns.push({ regex, level, message, hueColor, id: Date.now() });
            saveCustomPatterns();

            document.getElementById('new-pattern-regex').value = '';
            document.getElementById('new-pattern-msg').value = '';
            document.getElementById('new-pattern-hue').value = '';
            renderPatternList();
        }

        function removeCustomPattern(index) {
            customPatterns.splice(index, 1);
            saveCustomPatterns();
            renderPatternList();
        }

        function saveCustomPatterns() {
            ipcRenderer.invoke('settings:save-custom-patterns', customPatterns);
        }

        loadCustomPatterns();


        // ═══ UNKNOWN LOG DISCOVERY (Fixed: event delegation, full sample display) ═══
        // Store groups data for event delegation
        let unknownGroupsData = [];

        function escapeHtml(str) {
            if (typeof str !== 'string') return String(str || '');
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        // ... existing codes ...

        function renderUnknowns(groups) {
            unknownGroupsData = groups;
            const list = document.getElementById('unknown-list');
            unknownCount = groups.length;
            document.getElementById('unknown-count-label').textContent = `(${unknownCount})`;

            // Update badge
            const badge = document.getElementById('unknown-badge');
            if (unknownCount > 0) {
                badge.style.display = 'inline';
                badge.textContent = unknownCount;
            } else {
                badge.style.display = 'none';
            }

            if (groups.length === 0) {
                list.innerHTML = '<div style="color: #555; font-style: italic; padding: 15px; text-align: center;">No unknown patterns detected yet.</div>';
                return;
            }

            list.innerHTML = groups.slice(0, 50).map((g, i) => `
                <div class="unknown-item">
                    <div class="unknown-header">
                        <span class="unknown-key">${escapeHtml(g.group)}</span>
                        <span class="unknown-count">${g.count}x</span>
                        <div class="unknown-actions">
                            <button class="btn-copy" data-idx="${i}" title="Copy full log line">📋</button>
                            <button class="btn-ignore" data-idx="${i}" title="Ignore this pattern">🚫</button>
                        </div>
                    </div>
                    <div class="unknown-sample" title="${escapeHtml(g.sample)}">${escapeHtml(g.sample)}</div>
                </div>
            `).join('');
        }

        // Event delegation for unknown log buttons (fixes broken inline onclick)
        document.getElementById('unknown-list').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const idx = parseInt(btn.dataset.idx);
            if (isNaN(idx) || !unknownGroupsData[idx]) return;

            if (btn.classList.contains('btn-copy')) {
                navigator.clipboard.writeText(unknownGroupsData[idx].sample)
                    .then(() => addDashItem('📋', 'Copied to clipboard'))
                    .catch(() => addDashItem('❌', 'Copy failed'));
            } else if (btn.classList.contains('btn-ignore')) {
                ipcRenderer.send('log:ignore-unknown', unknownGroupsData[idx].group);
                addDashItem('🚫', `Ignored: ${unknownGroupsData[idx].group.substring(0, 40)}`);
            }
        });

        function refreshUnknowns() {
            ipcRenderer.send('log:request-unknowns');
        }

        function clearUnknowns() {
            ipcRenderer.send('log:clear-unknowns');
        }

        // ═══ ALERT COOLDOWNS ═══
        function updateCooldown(alertType, seconds) {
            document.getElementById(`cd-${alertType}-val`).textContent = `${seconds}s`;
            ipcRenderer.send('alert:set-cooldown', { alertType, cooldownMs: seconds * 1000 });
        }

        // Initialize cooldowns from defaults
        updateCooldown('suffocating', 5);
        updateCooldown('depressurizing', 5);

        // ═══ SHIP IMAGE ═══
        function selectShipImage() {
            ipcRenderer.invoke('app:select-ship-image').then(path => {
                if (path) {
                    document.getElementById('ship-image-path').value = path;
                    document.getElementById('ship-preview').style.display = 'block';
                    document.getElementById('ship-preview-img').src = path;
                    // Broadcast to overlay
                    ipcRenderer.send('app:login', ''); // slight hack, we directly use broadcast
                    // Actually, send via main → overlay
                    localStorage.setItem('shipImagePath', path);
                    addDashItem('🖼️', `Ship image set: ${path.split(/[\\/]/).pop()}`);
                }
            });
        }

        function clearShipImage() {
            document.getElementById('ship-image-path').value = '';
            document.getElementById('ship-preview').style.display = 'none';
            localStorage.removeItem('shipImagePath');
            addDashItem('🖼️', 'Ship image cleared');
        }

        // ═══ EVENT LISTENERS ═══

        // Game log events
        ipcRenderer.on('log:status', (e, data) => {
            const dot = document.getElementById('status-log-dot');
            const txt = document.getElementById('status-log-text');
            if (data.connected) {
                dot.className = 'dot on';
                txt.innerText = 'Active';
                if (data.path) {
                    document.getElementById('config-log-path').value = data.path;
                    addDashItem('📂', `Game.log: <span class="feed-highlight">${data.path}</span>`);
                }
            } else {
                dot.className = 'dot off';
                txt.innerText = data.message || 'Searching';
                if (data.message) {
                    addDashItem('⚠️', `Log issue: ${data.message}`);
                }
            }
        });

        // FIX 3: Handle log errors from main process
        ipcRenderer.on('log:error', (e, data) => {
            if (data && data.message) {
                addDashItem('❌', `Log Error: ${data.message}`);
            }
        });

        let lastGlobalLocation = '';
        let lastRawLocation = ''; // Added for Location Sniffing

        ipcRenderer.on('settings:friend-code', (e, code) => {
            document.getElementById('display-friend-code').textContent = code;
        });

        function copyFriendCode() {
            const code = document.getElementById('display-friend-code').textContent;
            navigator.clipboard.writeText(code);
            showNotification('📋 Friend Code Copied', 'Share it with your squadron!');
        }

        function addFriendByCode() {
            const input = document.getElementById('add-friend-code');
            const code = input.value.trim().toUpperCase();
            if (code.length !== 6) return alert('Invalid code. Must be 6 characters.');

            // Placeholder logic
            alert(`Sending friend request to ${code}...`);
            input.value = '';
        }

        function showNotification(title, body) {
            // Implementation of a small toast could go here, or use existing alerts
            console.log(`[Notification] ${title}: ${body}`);
        }

        ipcRenderer.on('log:update', (e, data) => {
            // Location Sniffing (v2.6)
            if (data.type === 'LOCATION' && data.raw) {
                lastRawLocation = data.raw;
                const sniffer = document.getElementById('last-raw-location');
                if (sniffer) sniffer.textContent = data.raw;
            } else if (data.type === 'LOCATION_RAW') {
                lastRawLocation = data.value;
                const sniffer = document.getElementById('last-raw-location');
                if (sniffer) sniffer.textContent = data.value;
            }

            // Raw Feed (Tail)
            addRawLogLine(data.raw || JSON.stringify(data)); // Fallback if no raw line

            switch (data.type) {
                case 'LOCATION':
                    lastGlobalLocation = data.value;
                    addDashItem('📍', `Location: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'LOCATION_HINT':
                    const display = lastGlobalLocation ? `${lastGlobalLocation} — ${data.value}` : data.value;
                    addDashItem('🗺️', `Area: <span class="feed-highlight">${display}</span>`);
                    break;
                case 'QUANTUM':
                    addDashItem('🚀', `Quantum: <span class="feed-highlight">${data.value === 'entered' ? 'ENGAGED' : 'DISENGAGED'}</span>`);
                    playSound('alert_zone');
                    break;
                case 'ZONE':
                    if (data.value === 'Armistice Zone') { addDashItem('🛡️', 'Entered <span class="feed-highlight">Armistice Zone</span>'); }
                    else if (data.value === 'Open Space') { addDashItem('⚠️', '<span class="feed-highlight" style="color:#ffaa00">LEFT ARMISTICE</span> — Weapons Hot'); playSound('alert_zone'); }
                    break;
                case 'STATUS':
                    if (data.value === 'suffocating') { addDashItem('😵', '<span class="feed-highlight" style="color:#ff4444">SUFFOCATING</span>'); playSound('alert_status'); }
                    else if (data.value === 'depressurizing') { addDashItem('💨', '<span class="feed-highlight" style="color:#ff4444">DEPRESSURIZATION</span>'); playSound('alert_status'); }
                    else if (data.value === 'death') { addDashItem('💀', '<span class="feed-highlight" style="color:#ff4444">DEATH DETECTED</span>'); playSound('alert_death'); }
                    break;
                case 'LOGIN':
                    addDashItem('👋', `Session: <span class="feed-highlight">${data.handle || 'Login Detected'}</span>`);
                    break;
                case 'PLAYER_NAME':
                    addDashItem('🎮', `Pilot: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'CHARACTER_NAME':
                    addDashItem('👤', `Character: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'CONNECTION':
                    addDashItem('🔗', `Connection: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'LOADING':
                    addDashItem('⏳', 'Loading screen...');
                    break;
                // ═══ NEW: Server & Environment ═══
                case 'SERVER_ENV':
                    addDashItem('🌍', `Server: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'SERVER_REGION':
                    addDashItem('🌐', `Region: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'SERVER_CONNECTED':
                    if (data.value && data.value.shard) {
                        addDashItem('🌐', `Shard: <span class="feed-highlight" style="color:#00c8ff">${data.value.shard}</span>`);
                    }
                    break;
                case 'JURISDICTION':
                    addDashItem('🏛️', `<span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'SESSION_ID':
                    addDashItem('🔑', `Session: <span class="feed-highlight" style="font-size:0.7rem">${data.value.substring(0, 12)}...</span>`);
                    break;
                // ═══ NEW: Ship Events ═══
                case 'SHIP_ENTER':
                    addDashItem('🚀', `Boarded: <span class="feed-highlight" style="color:#00c8ff">${data.value}</span>`);
                    document.getElementById('last-ship-debug').textContent = data.value; // Update Settings UI
                    playSound('notification');
                    break;
                case 'SHIP_EXIT':
                    addDashItem('🚶', `Exited ship: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'SHIP_CURRENT':
                    addDashItem('🚀', `Current ship: <span class="feed-highlight" style="color:#00c8ff">${data.value}</span>`);
                    break;
                case 'VEHICLE_SPAWN':
                    addDashItem('🛸', `Vehicle spawned: <span class="feed-highlight">${data.value}</span>`);
                    break;
                // ═══ NEW: Game Join/Leave ═══
                case 'GAME_JOIN':
                    addDashItem('🟢', `<span class="feed-highlight" style="color:var(--success)">ENTERED THE VERSE</span>`);
                    break;
                case 'GAME_LEAVE':
                    addDashItem('🔴', `<span class="feed-highlight" style="color:var(--danger)">LEFT THE VERSE</span>`);
                    break;
                // ═══ NEW: Unmapped Location Toast ═══
                case 'NEW_LOCATION':
                    showNewLocationToast(data.value || data.raw, data.raw);
                    break;
                    addDashItem('🎮', '<span class="feed-highlight" style="color:#00ff88">CONNECTED TO SERVER</span>');
                    playSound('notification');
                    break;
                case 'GAME_LEAVE':
                    addDashItem('🚪', '<span class="feed-highlight" style="color:#ffaa00">DISCONNECTED</span>');
                    playSound('alert_status');
                    break;
                case 'GAME_RESTART':
                    addDashItem('🔄', '<span class="feed-highlight">Game restarting...</span>');
                    break;
                // ═══ NEW: Multi-Mission List ═══
                case 'MISSION_ACCEPTED':
                case 'MISSION_OBJECTIVE':
                case 'MISSION_STATUS':
                case 'MISSION_CHANGED':
                    // These are handled via 'mission:list' broadcast usually, but if we get individual events we can ignore or log.
                    // Main.js sends 'mission:list' after these.
                    break;

                // ═══ NEW: Insurance ═══
                case 'INSURANCE_CLAIM':
                    addDashItem('🛡️', `<span class="feed-highlight" style="color:#a855f7">INSURANCE CLAIM</span>`);
                    playSound('alert_status');
                    break;
                // ═══ NEW: Docking ═══
                case 'DOCKING':
                    addDashItem('🔗', `Docking <span class="feed-highlight">${data.value}</span>`);
                    playSound('notification');
                    break;
                // ═══ NEW: Inventory ═══
                case 'INVENTORY':
                    addDashItem('📦', `Inventory <span class="feed-highlight">${data.value}</span>`);
                    break;
                // ═══ NEW: Medical & Spawn ═══
                case 'MEDICAL_BED':
                    addDashItem('🏥', '<span class="feed-highlight" style="color:#00c8ff">Medical Bed</span>');
                    break;
                case 'SPAWN_SET':
                case 'SPAWN_POINT':
                    addDashItem('📍', `Spawn: <span class="feed-highlight">${data.value}</span>`);
                    break;

                // ═══ PHASE 2: INDUSTRIAL ═══
                case 'MINING':
                    if (data.subtype === 'LASER') {
                        const color = data.state === 'ON' ? '#00ff88' : '#888';
                        addDashItem('⛏️', `Mining Laser: <span class="feed-highlight" style="color:${color}">${data.state}</span>`);
                    } else if (data.subtype === 'FRACTURE') {
                        const color = data.success ? '#00ff88' : '#ff4444';
                        const text = data.success ? 'SUCCESS' : 'FAILED';
                        addDashItem('💥', `Fracture: <span class="feed-highlight" style="color:${color}">${text}</span>`);
                        if (data.success) playSound('notification');
                    } else if (data.subtype === 'EXTRACTION') {
                        addDashItem('💎', `Extracted: <span class="feed-highlight" style="color:#ffa500">${data.amount.toFixed(2)} SCU</span> ${data.material}`);
                    }
                    break;

                case 'SALVAGE':
                    if (data.subtype === 'BEAM') {
                        const color = data.state === 'ON' ? '#00ff88' : '#888';
                        addDashItem('🏗️', `Salvage Beam: <span class="feed-highlight" style="color:${color}">${data.state}</span>`);
                    } else if (data.subtype === 'SCRAPE') {
                        addDashItem('♻️', `Scraped: <span class="feed-highlight" style="color:#00c8ff">${data.amount.toFixed(2)} SCU</span> ${data.material}`);
                    }
                    break;

                case 'ENGINEERING':
                    if (data.subtype === 'POWER') {
                        addDashItem('⚡', `Power Plant: <span class="feed-highlight">${data.state}</span>`);
                    } else if (data.subtype === 'FUSE_BREAK') {
                        addDashItem('🔌', `Fuse Blown: <span class="feed-highlight" style="color:#ff4444">${data.component}</span> in ${data.room}`);
                        playSound('alert_status');
                    }
                    break;

                // MISSION TRACKING
                case 'MISSION_CURRENT':
                    document.getElementById('mission-status-box').style.display = 'block';
                    document.getElementById('mission-title').innerText = data.value;
                    document.getElementById('mission-title').title = data.value; // Tooltip for overflow
                    addDashItem('📜', `Mission Accepted: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'MISSION_OBJECTIVE':
                    document.getElementById('mission-status-box').style.display = 'block';
                    document.getElementById('mission-objective').innerText = data.value;
                    addDashItem('🎯', `Objective: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'MISSION_CLEARED':
                    document.getElementById('mission-title').innerText = 'Completed / Ended';
                    document.getElementById('mission-objective').innerText = '-';
                    setTimeout(() => {
                        // Only hide if it hasn't been updated again
                        if (document.getElementById('mission-title').innerText.includes('Completed')) {
                            document.getElementById('mission-status-box').style.display = 'none';
                        }
                    }, 10000); // Keep result visible for 10s
                    addDashItem('✅', 'Mission Ended');
                    break;

                // ═══ NEW: Party ═══
                case 'PARTY_INVITE':
                    addDashItem('📩', '<span class="feed-highlight" style="color:#ffa500">Party invite pending</span>');
                    playSound('notification');
                    break;
                case 'ACCOUNT_LOGIN':
                    addDashItem('✅', '<span class="feed-highlight" style="color:#00ff88">Account Login Success</span>');
                    break;
                // System info
                case 'SYSTEM_GPU':
                    addDashItem('🖥️', `GPU: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'SYSTEM_VRAM':
                    addDashItem('🖥️', `VRAM: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'SYSTEM_CPU':
                    addDashItem('🖥️', `CPU: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'SYSTEM_RAM':
                    addDashItem('🖥️', `RAM: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'GAME_VERSION':
                    addDashItem('📦', `SC Branch: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'RESOLUTION':
                    addDashItem('🖥️', `Display: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'JOYSTICK':
                    addDashItem('🕹️', `Controller: <span class="feed-highlight">${data.value}</span>`);
                    break;
                case 'EQUIPMENT':
                    addDashItem('🎒', `Loadout: <span class="feed-highlight">${data.value.item}</span> → ${data.value.port}`);
                    break;
            }
        });

        ipcRenderer.on('log:error', (e, data) => {
            addDashItem('❌', `<span style="color:#ff4444">${data.message}</span>`);
            document.getElementById('status-log-dot').className = 'dot off';
            document.getElementById('status-log-text').innerText = 'Error';
        });

        // Unknown log events
        ipcRenderer.on('log:unknown', (e, data) => {
            renderUnknowns(data.groups || []);
        });

        // API connection
        ipcRenderer.on('api:status', (e, status) => {
            const dot = document.getElementById('status-api-dot');
            const txt = document.getElementById('status-api-text');
            if (status.connected) {
                dot.className = 'dot on'; txt.innerText = 'Secure';
                addDashItem('✅', 'VerseCon API Connected');
            } else {
                dot.className = 'dot off'; txt.innerText = 'Disconnected';
            }
        });

        // Party data
        ipcRenderer.on('api:party', (e, data) => {
            addDashItem('👥', `Party: <span class="feed-highlight">${data.members ? data.members.length : 0} Members</span>`);
        });

        // VerseCon platform events
        ipcRenderer.on('vcon:beacon', (e, data) => {
            addVconItem('🆘', `<span class="feed-highlight" style="color:#FF2E63">BEACON</span> — ${data.message || 'Distress signal!'}`);
            playSound('beacon');
        });

        ipcRenderer.on('vcon:job', (e, data) => {
            addVconItem('📜', `<span class="feed-highlight">CONTRACT</span> — ${data.message || 'New contract posted'}`);
            playSound('contract');
        });

        ipcRenderer.on('vcon:party_event', (e, data) => {
            const icon = data.type === 'LFG' ? '🎮' : '🎯';
            const label = data.type === 'LFG' ? 'LFG' : 'OPERATION';
            addVconItem(icon, `<span class="feed-highlight">${label}</span> — ${data.message || 'New event'}`);
            playSound('notification');
        });

        // v2.2 - Platform Notifications (Toasts & Feed)
        ipcRenderer.on('vcon:notification', (e, data) => {
            // data = { title, message, type: 'info|success|warning|error' }
            const iconMap = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
            const icon = iconMap[data.type] || '🔔';
            addVconItem(icon, `<span class="feed-highlight">${data.title}</span> — ${data.message}`);
            playSound('notification');
        });

        // Command events
        ipcRenderer.on('command:receive', (e, data) => {
            addCommandLog(data.preset || data.text, data.target || 'YOU', data.from || 'COMMAND');
            playSound(data.preset === 'EMERGENCY' ? 'sos' : 'command');
            // Also show in dashboard feed
            addDashItem('📢', `<span class="feed-highlight" style="color:#ffa500">ORDER: ${data.preset || data.text}</span> from ${data.from || 'Command'}`);
        });

        ipcRenderer.on('command:sent', (e, data) => {
            // Visual confirmation
        });

        // Auth deep link
        ipcRenderer.on('auth:success', (e, token) => {
            document.getElementById('auth-ui-guest').style.display = 'none';
            document.getElementById('auth-ui-user').style.display = 'block';
            addDashItem('✅', 'Authenticated via Browser!');
        });

        // DND toggle
        ipcRenderer.on('app:dnd', (e, data) => {
            addDashItem('🔕', data.enabled ? 'Do Not Disturb: ON' : 'Do Not Disturb: OFF');
        });

        // TTS Reaction (v2.8)
        ipcRenderer.on('app:tts', (e, text) => {
            if (dndMode) return;
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            window.speechSynthesis.speak(utterance);
        });

        // Keyboard shortcut for sending commands
        document.getElementById('cmd-custom-text').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendCustomCommand();
        });
        // v2.2 - Last Detected Ship Debugging
        ipcRenderer.on('settings:last-ship', (e, shipName) => {
            document.getElementById('last-ship-debug').textContent = shipName || 'None';
            document.getElementById('last-ship-debug').style.color = '#fff';
        });
        // ═══ CUSTOM LOCATIONS (Fixed) ═══
        let customLocations = {};

        function loadCustomLocationList() {
            ipcRenderer.invoke('settings:get-custom-locations').then(locs => {
                customLocations = locs || {};
                renderCustomLocationList();
            });
        }

        function renderCustomLocationList() {
            const list = document.getElementById('custom-location-list');
            if (!list) return;

            if (Object.keys(customLocations).length === 0) {
                list.innerHTML = '<div style="font-style:italic; color:#555; text-align:center; padding:10px;">No custom locations saved.</div>';
                return;
            }

            list.innerHTML = Object.entries(customLocations).map(([key, val]) => `
                        <div class="map-item" style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center; border-radius:4px; transition:background 0.2s; background:rgba(0,0,0,0.1);" onmouseenter="this.style.background='rgba(255,165,0,0.1)'" onmouseleave="this.style.background='rgba(0,0,0,0.1)'">
                            <div style="overflow:hidden; flex:1;">
                                <div style="font-family:monospace; color:var(--accent); font-size:0.8rem; font-weight:600;">${escapeHtml(key)}</div>
                                <div style="color:#00ff88; font-size:0.75rem; margin-top:2px;">➔ ${escapeHtml(val)}</div>
                            </div>
                            <button class="cyber-btn small" onclick="event.stopPropagation(); openLocationSearch(); selectLocationForEdit('${encodeURIComponent(key)}', '${encodeURIComponent(val)}')" style="margin-left:10px; margin:0 0 0 8px;">✏️</button>
                            <button class="cyber-btn small danger" onclick="deleteCustomLocation('${key}')" style="margin-left:5px; margin:0;">×</button>
                        </div>
                    `).join('');
        }

        // let lastRawLocation = ''; (Already declared above)

        function grabRawLocation() {
            if (!lastRawLocation) return;
            document.getElementById('new-loc-key').value = lastRawLocation;
            // Focus friendly name input for convenience
            document.getElementById('new-loc-val').focus();
        }

        // ═══ BUILT-IN PATTERN MANAGER (v2.2) ═══
        let defaultPatterns = {};
        let patternOverrides = {};

        async function loadBuiltinPatterns() {
            try {
                defaultPatterns = await ipcRenderer.invoke('settings:get-default-patterns');
                patternOverrides = await ipcRenderer.invoke('settings:get-pattern-overrides');
                renderBuiltinPatterns();
            } catch (e) {
                console.error('Failed to load patterns:', e);
            }
        }

        function renderBuiltinPatterns() {
            const list = document.getElementById('builtin-pattern-list');
            if (!list) return;
            list.innerHTML = '';

            const keys = Object.keys(defaultPatterns).sort();

            keys.forEach(key => {
                const config = patternOverrides[key] || {};
                const isDisabled = config.disabled;
                const currentRegex = config.regex || defaultPatterns[key];
                const defaultRegex = defaultPatterns[key];
                const customMsg = config.message || '';

                const item = document.createElement('div');
                item.className = 'map-item';
                item.style.cssText = 'padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05);';
                item.innerHTML = `
                            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                                <span style="color: var(--accent); font-weight: bold; font-family: monospace; font-size: 0.9rem;">${key}</span>
                                <label style="font-size: 0.8rem; cursor: pointer;">
                                    <input type="checkbox" ${isDisabled ? '' : 'checked'} onchange="togglePattern('${key}', this.checked)"> Enabled
                                </label>
                            </div>
                            <div style="font-size: 0.7rem; color: #888; margin-bottom: 2px;">Trigger Regex:</div>
                            <div style="font-family:monospace; font-size:0.7rem; color:#666; margin-bottom:2px;">Default: ${escapeHtml(defaultRegex.toString())}</div>
                            <input type="text" class="modern-input" style="width: 100%; font-family: monospace; font-size: 0.8rem; margin-bottom: 8px; color: #aaffaa;"
                                value="${escapeHtml(currentRegex.toString())}" 
                                onchange="updatePatternRegex('${key}', this.value)"
                                ${isDisabled ? 'disabled' : ''}
                                placeholder="Regex Pattern">
                            <div style="font-size: 0.7rem; color: #888; margin-bottom: 2px;">Alert Message (Override):</div>
                            <input type="text" class="modern-input" style="width: 100%; font-size: 0.8rem;"
                                value="${escapeHtml(customMsg)}"
                                onchange="updatePatternMessage('${key}', this.value)"
                                ${isDisabled ? 'disabled' : ''}
                                placeholder="Leave empty to use system default...">
                        `;
                list.appendChild(item);
            });
        }

        function renderBuiltinList() {
            // Backwards compatibility for older calls
            renderBuiltinPatterns();
        }

        function updatePatternValueMap(key, value) {
            if (!patternOverrides[key]) patternOverrides[key] = {};
            patternOverrides[key].valueMap = value;
            savePatternOverrides();
        }

        function togglePattern(key, enabled) {
            if (!patternOverrides[key]) patternOverrides[key] = {};
            patternOverrides[key].disabled = !enabled;
            // If re-enabling and no other overrides, maybe clean up?
            // For now just save state.
            savePatternOverrides();
            renderBuiltinList();
        }

        function updatePatternRegex(key, value) {
            if (!patternOverrides[key]) patternOverrides[key] = {};
            patternOverrides[key].regex = value;
            // If value matches default, strictly we could remove it, but explicit override is safer for user intent
            savePatternOverrides();
        }

        function updatePatternMessage(key, value) {
            if (!patternOverrides[key]) patternOverrides[key] = {};
            patternOverrides[key].message = value;
            savePatternOverrides();
        }

        async function savePatternOverrides() {
            await ipcRenderer.invoke('settings:save-pattern-overrides', patternOverrides);
            const btn = document.activeElement;
            if (btn && btn.tagName === 'BUTTON') {
                const originalText = btn.innerText;
                btn.innerText = 'Saved!';
                setTimeout(() => btn.innerText = originalText, 2000);
            }
        }

        async function resetPatternOverrides() {
            if (confirm('Reset all built-in patterns to default?')) {
                patternOverrides = {};
                await ipcRenderer.invoke('settings:save-pattern-overrides', patternOverrides);
                renderBuiltinPatterns();
            }
        }

        // Raw log stream (v2.6 Batching)
        ipcRenderer.on('log:raw-batch', (e, batch) => {
            if (!Array.isArray(batch)) return;
            batch.forEach(line => addRawLogLine(line));
        });

        // Legacy support if needed
        ipcRenderer.on('log:raw', (e, line) => addRawLogLine(line));

        function addRawLogLine(line) {
            updateRecentLocations(line); // Pass to Settings Sniffer

            const rawFeed = document.getElementById('raw-log-list');
            if (!rawFeed) return;

            const div = document.createElement('div');
            div.className = 'log-line';
            div.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.06); padding: 5px 4px; white-space: pre-wrap; word-break: break-all; cursor: pointer; transition: background 0.2s; border-radius: 2px;';
            div.title = 'Click to copy & use in Custom Locations';
            div.textContent = line;

            div.onclick = () => {
                navigator.clipboard.writeText(line);
                div.style.background = 'rgba(255,165,0,0.2)';
                setTimeout(() => div.style.background = 'transparent', 200);

                const locInput = document.getElementById('new-loc-key');
                if (locInput) {
                    let match = line.match(/RoomName:\s*([^\s]+)/) || line.match(/Location\[([^\]]+)\]/);
                    if (match) {
                        locInput.value = match[1];
                        document.getElementById('new-loc-val').focus();
                        alert('Code copied to Custom Location input: ' + match[1]);
                    } else {
                        if (!locInput.value) locInput.value = line;
                        addDashItem('📋', 'Log line copied to clipboard');
                    }
                }
            };

            const filterInput = document.getElementById('raw-log-filter');
            const filterText = filterInput && filterInput.value ? filterInput.value.toLowerCase() : '';
            if (filterText && typeof line === 'string' && !line.toLowerCase().includes(filterText)) {
                div.style.display = 'none';
            }

            rawFeed.prepend(div);
            if (rawFeed.children.length > 100) rawFeed.lastElementChild.remove();
        }

        function filterRawLogs() {
            const term = document.getElementById('raw-log-filter').value.toLowerCase();
            const rawFeed = document.getElementById('raw-log-list');
            if (rawFeed) {
                Array.from(rawFeed.children).forEach(child => {
                    if (child.classList.contains('log-line')) {
                        if (!term || child.textContent.toLowerCase().includes(term)) {
                            child.style.display = '';
                        } else {
                            child.style.display = 'none';
                        }
                    }
                });
            }
        }

        // ═══ NEW: Mission List Renderer ═══
        ipcRenderer.on('mission:list', (e, missions) => {
            renderMissionList(missions);
        });

        function renderMissionList(missions) {
            const container = document.getElementById('mission-status-box');
            if (!missions || missions.length === 0) {
                container.style.display = 'none';
                return;
            }

            container.style.display = 'block';

            // Sort: Tracked first, then new
            missions.sort((a, b) => (b.tracked ? 1 : 0) - (a.tracked ? 1 : 0) || b.timestamp - a.timestamp);

            container.innerHTML = missions.map(m => `
                <div class="mission-entry ${m.tracked ? 'tracked' : ''}" style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px">
                        <div style="font-size:0.7rem; color:${m.tracked ? 'var(--accent)' : '#888'}; font-weight:700; letter-spacing:1px">
                            ${m.tracked ? 'ACTIVE CONTRACT' : 'CONTRACT'}
                             <!-- ID for renaming context -->
                             ${m.tracked ? `<span onclick="window.currentMissionId='${m.id}'; renameCurrentMission()" style="cursor:pointer; margin-left:5px; opacity:0.7;" title="Rename Mission">✏️</span>` : ''}
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="font-size:0.6rem; background:${m.tracked ? 'rgba(255,165,0,0.2)' : 'rgba(255,255,255,0.05)'}; 
                                        color:${m.tracked ? 'orange' : '#aaa'}; padding:1px 4px; border-radius:2px">
                                ${m.status === 'active' ? 'IN PROGRESS' : m.status.toUpperCase()}
                            </div>
                                    <span onclick="dismissMission('${m.id.replace(/'/g, "\\'")}')" style="cursor:pointer; color:#ff4444; font-size:0.8rem;" title="Dismiss / Remove" class="no-drag">❌</span>
                                </div>
                    </div>
                    <div style="font-weight:600; color:${m.tracked ? 'white' : '#ccc'}; margin-bottom:4px; font-size: 0.85rem; line-height:1.2;">
                        ${escapeHtml(m.title)}
                    </div>
                    ${m.tracked ? `
                    <div style="font-size:0.65rem; color: #666; text-transform:uppercase; letter-spacing:0.5px">Objective</div>
                    <div style="font-size:0.75rem; color:#ddd; line-height:1.2;">${escapeHtml(m.objective)}</div>
                    ` : ''}
                </div>
            `).join('');

            // Allow renaming logic to work
            const tracked = missions.find(m => m.tracked);
            if (tracked) window.currentMissionId = tracked.id;
        }

        window.dismissMission = function (id) {
            // Encode/Escape not strictly needed if we pass ID cleanly, but IPC handles strings fine.
            ipcRenderer.send('mission:dismiss', id);
        };

        // ═══════════════════════════════════════════════════════
        // SETTINGS: PATTERN GENERATOR (New)
        // ═══════════════════════════════════════════════════════
        function generatePattern() {
            const input = document.getElementById('pattern-gen-input').value.trim();
            if (!input) return;

            // Simple heuristic to create a regex from a log line
            // 1. Escape special characters
            let escap = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // 2. Replace timestamps with rigid regex (e.g. <2026-02-09T...>)
            // <\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?>
            escap = escap.replace(/&lt;\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*?&gt;/g, '<.*?>'); // simplistic
            escap = escap.replace(/<\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*?>/g, '<.*?>');

            // 3. Replace quoted strings if they look variable?
            // checking for "Something" -> "[^"]+"
            // Maybe safer to leave them unless user wants wildcards.

            // 4. Replace specific ID-like sequences?
            // matching hexadecimal hashes or long digits
            escap = escap.replace(/0x[0-9a-fA-F]+/g, '0x[0-9a-fA-F]+');

            // Output
            const output = document.getElementById('pattern-gen-output');
            output.value = escap;

            // Flash success
            output.style.borderColor = 'var(--success)';
            setTimeout(() => output.style.borderColor = 'rgba(255,255,255,0.1)', 500);
        }

        function copyGeneratedPattern() {
            const output = document.getElementById('pattern-gen-output');
            output.select();
            document.execCommand('copy');
            addDashItem('📋', 'Pattern copied to clipboard');
        }

        // ═══════════════════════════════════════════════════════
        // SETTINGS: RECENT LOG SNIFFER
        // ═══════════════════════════════════════════════════════
        const recentLocations = [];

        function updateRecentLocations(line) {
            // Sniff location lines
            let match = line.match(/RoomName:\s*([^\s]+)/) || line.match(/Location\[([^\]]+)\]/);
            if (match) {
                const loc = match[1];
                // Avoid dupes
                if (!recentLocations.includes(loc)) {
                    recentLocations.unshift(loc);
                    if (recentLocations.length > 5) recentLocations.pop();
                    renderRecentLocations();
                }
            }
        }

        function renderRecentLocations() {
            const container = document.getElementById('recent-locs-container');
            if (!container) return; // Might need to add to HTML

            if (recentLocations.length === 0) {
                container.innerHTML = '<div style="font-style:italic; color:#555;">No recent locations detected...</div>';
                return;
            }

            container.innerHTML = recentLocations.map(loc => `
                  <div onclick="document.getElementById('new-loc-key').value='${loc}'; document.getElementById('new-loc-val').focus();" 
                       style="cursor:pointer; padding:4px; border-bottom:1px solid rgba(255,255,255,0.05); font-family:monospace; font-size:0.75rem; color:#aaa;">
                       ${loc} <span style="float:right; color:var(--accent);">Use ➔</span>
                  </div>
             `).join('');
        }

        // ═══════════════════════════════════════════════════════
        // SETTINGS: PATTERN MANAGER (Enhanced)
        // ═══════════════════════════════════════════════════════

        async function loadBuiltinPatterns() {
            try {
                defaultPatterns = await ipcRenderer.invoke('settings:get-default-patterns');
                patternOverrides = await ipcRenderer.invoke('settings:get-pattern-overrides');
                renderBuiltinPatterns();
            } catch (e) {
                console.error('Failed to load patterns:', e);
            }
        }

        function renderBuiltinPatterns() {
            const list = document.getElementById('builtin-pattern-list');
            if (!list) return;
            list.innerHTML = '';

            const keys = Object.keys(defaultPatterns).sort();

            keys.forEach(key => {
                const config = patternOverrides[key] || {};
                const isDisabled = config.disabled;
                const currentRegex = config.regex || defaultPatterns[key];
                const defaultRegex = defaultPatterns[key]; // For reference
                const customMsg = config.message || '';

                // We don't easily know the "default message" unless we map it server-side, 
                // but we can at least show the regex clearly.

                const item = document.createElement('div');
                item.className = 'map-item';
                item.style.cssText = 'padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05);';
                item.innerHTML = `
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        <span style="color: var(--accent); font-weight: bold; font-family: monospace; font-size: 0.9rem;">${key}</span>
                        <label style="font-size: 0.8rem; cursor: pointer;">
                            <input type="checkbox" ${isDisabled ? '' : 'checked'} onchange="togglePattern('${key}', this.checked)"> Enabled
                        </label>
                    </div>
                    
                    <div style="font-size: 0.7rem; color: #888; margin-bottom: 2px;">Trigger Regex:</div>
                    <div style="font-family:monospace; font-size:0.7rem; color:#666; margin-bottom:2px;">Default: ${escapeHtml(defaultRegex.toString())}</div>
                    <input type="text" class="modern-input" style="width: 100%; font-family: monospace; font-size: 0.8rem; margin-bottom: 8px; color: #aaffaa;"
                        value="${escapeHtml(currentRegex.toString())}" 
                        onchange="updatePatternRegex('${key}', this.value)"
                        ${isDisabled ? 'disabled' : ''}
                        placeholder="Regex Pattern">
                    
                    <div style="font-size: 0.7rem; color: #888; margin-bottom: 2px;">Alert Message (Override):</div>
                    <input type="text" class="modern-input" style="width: 100%; font-size: 0.8rem;"
                        value="${escapeHtml(customMsg)}"
                        onchange="updatePatternMessage('${key}', this.value)"
                        ${isDisabled ? 'disabled' : ''}
                        placeholder="Leave empty to use system default...">
                `;
                list.appendChild(item);
            });
        }

        function saveNewCustomLocation() {
            const key = document.getElementById('new-loc-key').value.trim();
            const val = document.getElementById('new-loc-val').value.trim();
            if (!key || !val) return alert('Please enter both a raw code and a friendly name.');

            customLocations[key] = val;
            ipcRenderer.invoke('settings:save-custom-locations', customLocations);

            // Feedback
            addDashItem('✅', `Mapped <span style="color:#ffaa00; font-family:monospace;">${escapeHtml(key)}</span> → <span style="color:#00ff88;">${escapeHtml(val)}</span>`);

            // Clear inputs
            document.getElementById('new-loc-key').value = '';
            document.getElementById('new-loc-val').value = '';
            renderCustomLocationList();
        }

        function addCustomLocationPrompt() {
            document.getElementById('new-loc-key').focus();
        }

        window.deleteCustomLocation = function (key) {
            if (confirm(`Remove location mapping for "${key}"?`)) {
                delete customLocations[key];
                ipcRenderer.invoke('settings:save-custom-locations', customLocations);
                renderCustomLocationList();
                // Close modal if it was the edited one
                if (document.getElementById('location-edit-original-key').value === key) {
                    closeLocationSearchModal();
                }
            }
        };

        // ═══ CUSTOM LOCATION SEARCH & EDIT (New Feature) ═══
        let locationSearchCache = {};
        let selectedLocationKey = null;

        function openLocationSearch() {
            locationSearchCache = { ...customLocations };
            selectedLocationKey = null;
            document.getElementById('location-search-input').value = '';
            document.getElementById('location-edit-panel').style.display = 'none';
            renderLocationSearchResults();
            document.getElementById('location-search-modal').style.display = 'flex';
        }

        function closeLocationSearchModal() {
            document.getElementById('location-search-modal').style.display = 'none';
            selectedLocationKey = null;
            document.getElementById('location-edit-panel').style.display = 'none';
        }

        function filterLocationSearch() {
            renderLocationSearchResults();
        }

        function clearLocationSearch() {
            document.getElementById('location-search-input').value = '';
            renderLocationSearchResults();
        }

        function renderLocationSearchResults() {
            const search = document.getElementById('location-search-input').value.toLowerCase();
            const resultsList = document.getElementById('location-search-results');

            // Filter locations
            let filtered = Object.entries(locationSearchCache).filter(([key, val]) =>
                key.toLowerCase().includes(search) || val.toLowerCase().includes(search)
            );

            document.getElementById('location-search-count').textContent = filtered.length;

            if (filtered.length === 0) {
                resultsList.innerHTML = '<div style="color:#666; font-style:italic; text-align:center; padding:20px;">No locations match your search.</div>';
                return;
            }

            resultsList.innerHTML = filtered.map(([key, val]) => `
                <div class="map-item" style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); 
                    cursor:pointer; border-radius:4px; transition:background 0.2s; background:${selectedLocationKey === key ? 'rgba(255,165,0,0.15)' : 'transparent'};"
                    onclick="selectLocationForEdit('${encodeURIComponent(key)}', '${encodeURIComponent(val)}')">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="overflow:hidden; flex:1;">
                            <div style="font-family:monospace; color:var(--accent); font-size:0.8rem; font-weight:600;">${escapeHtml(key)}</div>
                            <div style="color:#00ff88; font-size:0.75rem; margin-top:2px;">➔ ${escapeHtml(val)}</div>
                        </div>
                        <button class="cyber-btn small" style="margin:0; margin-left:8px;" onclick="event.stopPropagation(); selectLocationForEdit('${encodeURIComponent(key)}', '${encodeURIComponent(val)}')">
                            ✏️
                        </button>
                    </div>
                </div>
            `).join('');
        }

        function selectLocationForEdit(encodedKey, encodedVal) {
            const key = decodeURIComponent(encodedKey);
            const val = decodeURIComponent(encodedVal);
            selectedLocationKey = key;

            document.getElementById('location-edit-original-key').value = key;
            document.getElementById('location-edit-key').value = key;
            document.getElementById('location-edit-val').value = val;
            document.getElementById('location-edit-panel').style.display = 'block';
            renderLocationSearchResults(); // Re-render to show selection highlighting
        }

        function saveLocationEdit() {
            const originalKey = document.getElementById('location-edit-original-key').value;
            const newVal = document.getElementById('location-edit-val').value.trim();

            if (!newVal) {
                alert('Please enter a friendly name.');
                return;
            }

            // Delete old key if it was renamed
            if (selectedLocationKey !== originalKey) {
                delete customLocations[originalKey];
            }

            // Update with new value
            customLocations[selectedLocationKey] = newVal;
            ipcRenderer.invoke('settings:save-custom-locations', customLocations);

            // Update both modal and main location list
            addDashItem('✅', `Updated: ${selectedLocationKey} → ${escapeHtml(newVal)}`);
            renderCustomLocationList();
            closeLocationSearchModal();
        }

        function deleteSelectedLocation() {
            const key = document.getElementById('location-edit-original-key').value;
            if (confirm(`Delete location mapping "${key}"?`)) {
                window.deleteCustomLocation(key);
            }
        }

        function cancelLocationEdit() {
            document.getElementById('location-edit-panel').style.display = 'none';
            selectedLocationKey = null;
            renderLocationSearchResults();
        }

        // ═══ LOG PATTERN DATABASE (v2.7) ═══
        let patternDB = { _meta: {}, patterns: [] };

        async function loadPatternDB() {
            try {
                patternDB = await ipcRenderer.invoke('patterns:load');
                renderPatternDB();
            } catch (e) {
                console.error('Failed to load pattern DB:', e);
            }
        }

        function renderPatternDB(filtered) {
            const patterns = filtered || patternDB.patterns;
            const list = document.getElementById('logdb-list');

            // Stats
            document.getElementById('logdb-total').textContent = patternDB.patterns.length;
            document.getElementById('logdb-verified').textContent = patternDB.patterns.filter(p => p.status === 'verified').length;
            document.getElementById('logdb-research').textContent = patternDB.patterns.filter(p => p.status === 'research').length;
            document.getElementById('logdb-updated').textContent = patternDB._meta.lastUpdated || '—';

            // Populate category filter
            const catSelect = document.getElementById('logdb-category');
            const currentCat = catSelect.value;
            const cats = [...new Set(patternDB.patterns.map(p => p.category))].sort();
            catSelect.innerHTML = '<option value="">All Categories</option>' +
                cats.map(c => `<option value="${c}" ${c === currentCat ? 'selected' : ''}>${c}</option>`).join('');

            if (patterns.length === 0) {
                list.innerHTML = '<div style="color:#555; font-style:italic; padding:30px; text-align:center;">No patterns found.</div>';
                return;
            }

            const categoryColors = {
                Vehicle: '#00c8ff', Navigation: '#00ff88', Combat: '#ff4444', Mission: '#ffa500',
                Hazard: '#ff6600', Session: '#aa88ff', Fire: '#ff2222', Inventory: '#888',
                Social: '#44aaff', Industrial: '#ffcc00', Other: '#666'
            };

            list.innerHTML = patterns.map(p => {
                const catColor = categoryColors[p.category] || '#888';
                const statusIcon = p.status === 'verified' ? '✅' : '🔬';
                const statusColor = p.status === 'verified' ? '#00ff88' : '#ffaa00';
                return `
                    <div style="padding:12px; border-bottom:1px solid rgba(255,255,255,0.05); transition:background 0.2s;"
                         onmouseenter="this.style.background='rgba(255,165,0,0.05)'"
                         onmouseleave="this.style.background='transparent'">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <div style="display:flex; gap:8px; align-items:center;">
                                <span style="background:${catColor}22; color:${catColor}; padding:2px 6px; border-radius:3px;
                                    font-size:0.65rem; font-weight:700; letter-spacing:0.5px;">${escapeHtml(p.category)}</span>
                                <span style="font-weight:600; color:#eee; font-size:0.9rem;">${escapeHtml(p.name)}</span>
                                <span style="color:${statusColor}; font-size:0.7rem;">${statusIcon} ${p.status}</span>
                            </div>
                            <div style="display:flex; gap:4px;">
                                <button class="cyber-btn small" onclick="editPattern('${p.id}')" style="margin:0; font-size:0.65rem;">✏️</button>
                                <button class="cyber-btn small" onclick="copyPatternRegex('${p.id}')" style="margin:0; font-size:0.65rem;">📋</button>
                                <button class="cyber-btn small danger" onclick="deletePattern('${p.id}')" style="margin:0; font-size:0.65rem;">🗑️</button>
                            </div>
                        </div>
                        <div style="font-family:monospace; font-size:0.75rem; color:#aaffaa; background:rgba(0,0,0,0.3);
                            padding:4px 8px; border-radius:3px; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${escapeHtml(p.regex)}
                        </div>
                        <div style="font-family:monospace; font-size:0.7rem; color:#bbb; background:rgba(0,0,0,0.2);
                            padding:3px 8px; border-radius:3px; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            📝 ${escapeHtml(p.example || 'No example')}
                        </div>
                        <div style="display:flex; gap:10px; font-size:0.7rem; color:#888; margin-bottom:4px;">
                            <span>Event: <b style="color:var(--accent);">${escapeHtml(p.event)}</b></span>
                            ${p.alert && p.alert !== 'none' ? `<span>Alert: <b style="color:#ff4444;">${p.alert.toUpperCase()}</b></span>` : ''}
                            ${p.warning ? `<span>Warning: <b style="color:#00c8ff;">"${escapeHtml(p.warning)}"</b></span>` : ''}
                            ${p.reaction ? `<span>Reaction: <b style="color:#aa88ff;">${escapeHtml(p.reaction)}</b></span>` : ''}
                        </div>
                        ${p.notes ? `<div style="font-size:0.7rem; color:#666; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">💬 ${escapeHtml(p.notes)}</div>` : ''}
                    </div>
                `;
            }).join('');
        }

        function filterPatternDB() {
            const search = document.getElementById('logdb-search').value.toLowerCase();
            const cat = document.getElementById('logdb-category').value;
            const status = document.getElementById('logdb-status').value;

            let filtered = patternDB.patterns;
            if (search) {
                filtered = filtered.filter(p =>
                    p.name.toLowerCase().includes(search) ||
                    p.regex.toLowerCase().includes(search) ||
                    p.event.toLowerCase().includes(search) ||
                    (p.notes && p.notes.toLowerCase().includes(search)) ||
                    (p.example && p.example.toLowerCase().includes(search)) ||
                    (p.warning && p.warning.toLowerCase().includes(search)) ||
                    (p.reaction && p.reaction.toLowerCase().includes(search))
                );
            }
            if (cat) filtered = filtered.filter(p => p.category === cat);
            if (status) filtered = filtered.filter(p => p.status === status);

            renderPatternDB(filtered);
        }

        function showAddPatternModal() {
            document.getElementById('logdb-modal-title').textContent = 'Add Pattern';
            document.getElementById('pm-name').value = '';
            document.getElementById('pm-category').value = 'Other';
            document.getElementById('pm-event').value = '';
            document.getElementById('pm-status').value = 'research';
            document.getElementById('pm-regex').value = '';
            document.getElementById('pm-example').value = '';
            document.getElementById('pm-alert').value = 'none';
            document.getElementById('pm-warning').value = '';
            document.getElementById('pm-reaction').value = '';
            document.getElementById('pm-notes').value = '';
            document.getElementById('pm-edit-id').value = '';
            document.getElementById('pm-test-result').textContent = 'Click Test to verify regex against example';
            document.getElementById('pm-test-result').style.color = '#666';
            document.getElementById('logdb-modal').style.display = 'flex';
        }

        function editPattern(id) {
            const p = patternDB.patterns.find(x => x.id === id);
            if (!p) return;
            document.getElementById('logdb-modal-title').textContent = 'Edit Pattern';
            document.getElementById('pm-name').value = p.name || '';
            document.getElementById('pm-category').value = p.category || 'Other';
            document.getElementById('pm-event').value = p.event || '';
            document.getElementById('pm-status').value = p.status || 'research';
            document.getElementById('pm-regex').value = p.regex || '';
            document.getElementById('pm-example').value = p.example || '';
            document.getElementById('pm-alert').value = p.alert || 'none';
            document.getElementById('pm-warning').value = p.warning || '';
            document.getElementById('pm-reaction').value = p.reaction || '';
            document.getElementById('pm-notes').value = p.notes || '';
            document.getElementById('pm-edit-id').value = id;
            document.getElementById('pm-test-result').textContent = 'Click Test to verify regex against example';
            document.getElementById('pm-test-result').style.color = '#666';
            document.getElementById('logdb-modal').style.display = 'flex';
        }

        function closePatternModal() {
            document.getElementById('logdb-modal').style.display = 'none';
        }

        async function savePatternFromModal() {
            const editId = document.getElementById('pm-edit-id').value;
            const data = {
                name: document.getElementById('pm-name').value.trim(),
                category: document.getElementById('pm-category').value,
                event: document.getElementById('pm-event').value.trim(),
                status: document.getElementById('pm-status').value,
                regex: document.getElementById('pm-regex').value.trim(),
                example: document.getElementById('pm-example').value.trim(),
                alert: document.getElementById('pm-alert').value,
                warning: document.getElementById('pm-warning').value.trim(),
                reaction: document.getElementById('pm-reaction').value.trim(),
                notes: document.getElementById('pm-notes').value.trim()
            };

            if (!data.name || !data.regex) {
                alert('Name and Regex are required.');
                return;
            }

            try {
                if (editId) {
                    patternDB = await ipcRenderer.invoke('patterns:update', editId, data);
                } else {
                    patternDB = await ipcRenderer.invoke('patterns:add', data);
                }
                closePatternModal();
                renderPatternDB();
                addDashItem('✅', `Pattern ${editId ? 'updated' : 'added'}: ${data.name}`);
            } catch (e) {
                console.error('Failed to save pattern:', e);
            }
        }

        async function deletePattern(id) {
            const p = patternDB.patterns.find(x => x.id === id);
            if (!p) return;
            if (!confirm(`Delete pattern "${p.name}"?`)) return;

            try {
                patternDB = await ipcRenderer.invoke('patterns:delete', id);
                renderPatternDB();
                addDashItem('🗑️', `Deleted pattern: ${p.name}`);
            } catch (e) {
                console.error('Failed to delete pattern:', e);
            }
        }

        function copyPatternRegex(id) {
            const p = patternDB.patterns.find(x => x.id === id);
            if (!p) return;
            navigator.clipboard.writeText(p.regex)
                .then(() => addDashItem('📋', `Copied regex for: ${p.name}`))
                .catch(() => addDashItem('❌', 'Copy failed'));
        }

        function testPatternRegex() {
            const regex = document.getElementById('pm-regex').value;
            const example = document.getElementById('pm-example').value;
            const resultEl = document.getElementById('pm-test-result');

            if (!regex || !example) {
                resultEl.textContent = 'Enter both regex and example to test';
                resultEl.style.color = '#ffaa00';
                return;
            }

            try {
                const re = new RegExp(regex, 'i');
                const match = example.match(re);
                if (match) {
                    resultEl.style.color = '#00ff88';
                    if (match.length > 1) {
                        resultEl.textContent = `✅ MATCH! Groups: [${match.slice(1).join(', ')}]`;
                    } else {
                        resultEl.textContent = '✅ MATCH! (no capture groups)';
                    }
                } else {
                    resultEl.style.color = '#ff4444';
                    resultEl.textContent = '❌ NO MATCH — regex does not match the example';
                }
            } catch (e) {
                resultEl.style.color = '#ff4444';
                resultEl.textContent = `⚠️ Invalid regex: ${e.message}`;
            }
        }

        async function exportPatternDB() {
            try {
                const path = await ipcRenderer.invoke('patterns:export');
                if (path) {
                    addDashItem('📤', `Exported to: ${path}`);
                }
            } catch (e) {
                console.error('Export failed:', e);
            }
        }

        async function importPatternDB() {
            try {
                const result = await ipcRenderer.invoke('patterns:import');
                if (result && result.success) {
                    patternDB = await ipcRenderer.invoke('patterns:load');
                    renderPatternDB();
                    addDashItem('📥', `Imported ${result.added} new patterns (${result.total} total)`);
                } else if (result && !result.success) {
                    addDashItem('❌', `Import failed: ${result.error}`);
                }
            } catch (e) {
                console.error('Import failed:', e);
            }
        }

        function toggleHUDLock(unlock) {
            ipcRenderer.send('overlay:unlock', unlock);
            if (unlock) {
                addDashItem('🔧', 'HUD Unlocked — Drag elements on overlay to move them');
            } else {
                addDashItem('🔒', 'HUD Locked — Positions saved');
            }
        }

        function saveTeamNames() {
            const names = [
                document.getElementById('team-name-0').value || 'Alpha',
                document.getElementById('team-name-1').value || 'Bravo',
                document.getElementById('team-name-2').value || 'Charlie',
                document.getElementById('team-name-3').value || 'Delta'
            ];
            config.teamNames = names;
            saveConfig();
            updateTeamUIs();
        }

        function updateTeamUIs() {
            const names = config.teamNames || ['Alpha', 'Bravo', 'Charlie', 'Delta'];

            // Update Settings Inputs
            for (let i = 0; i < 4; i++) {
                const el = document.getElementById(`team-name-${i}`);
                if (el) el.value = names[i];
            }

            // Update Target Dropdown
            const targetSelect = document.getElementById('cmd-target');
            if (targetSelect) {
                targetSelect.options[1].textContent = `🏷️ ${names[0]}`; targetSelect.options[1].value = names[0].toUpperCase();
                targetSelect.options[2].textContent = `🏷️ ${names[1]}`; targetSelect.options[2].value = names[1].toUpperCase();
                targetSelect.options[3].textContent = `🏷️ ${names[2]}`; targetSelect.options[3].value = names[2].toUpperCase();
                targetSelect.options[4].textContent = `🏷️ ${names[3]}`; targetSelect.options[4].value = names[3].toUpperCase();
            }

            // Update Your Team Dropdown
            const userTeamSelect = document.getElementById('config-user-team');
            if (userTeamSelect) {
                for (let i = 0; i < 4; i++) {
                    userTeamSelect.options[i].textContent = names[i];
                    userTeamSelect.options[i].value = names[i];
                }
            }
        }

        async function discoverHueBridge() {
            addDashItem('🔍', 'Searching for Hue Bridge...');
            const results = await ipcRenderer.invoke('hue:discover');
            if (results && results.length > 0) {
                const ip = results[0].internalipaddress;
                document.getElementById('config-hue-bridge').value = ip;
                addDashItem('💡', `Bridge found at ${ip}`);
                saveConfig();
            } else {
                addDashItem('❌', 'No Hue Bridge found on network');
            }
        }

        async function testHueLights() {
            const bridgeIp = document.getElementById('config-hue-bridge').value;
            const username = document.getElementById('config-hue-user').value;
            const lights = document.getElementById('config-hue-lights').value.split(',').map(l => l.trim());

            addDashItem('🧪', 'Testing Hue connection...');
            const res = await ipcRenderer.invoke('hue:control', {
                bridgeIp,
                username,
                lightId: lights,
                state: { on: true, alert: 'select' }
            });
            console.log('Hue Test Res:', res);
        }

        async function linkHueBridge() {
            const ip = document.getElementById('config-hue-bridge').value;
            if (!ip) return alert('Discover or enter Bridge IP first.');
            addDashItem('🔗', 'Attempting to link Bridge... (Press the physical button on Hue Bridge NOW!)');
            const res = await ipcRenderer.invoke('hue:link', ip);
            if (res && res[0] && res[0].success) {
                document.getElementById('config-hue-user').value = res[0].success.username;
                addDashItem('✅', 'Bridge Linked successfully!');
                saveConfig();
            } else if (res && res[0] && res[0].error) {
                addDashItem('⚠️', 'Link failed: ' + res[0].error.description);
            }
        }

        function checkPlatformStatus() {
            // Pulse check broadcast-kit (running on 3000)
            fetch('http://localhost:3000/api/control/status')
                .then(r => r.json())
                .then(data => {
                    // Twitch
                    const tDot = document.getElementById('status-twitch-dot');
                    const tText = document.getElementById('status-twitch-text');
                    if (tDot) tDot.className = data.online ? 'dot on' : 'dot off';
                    if (tText) tText.textContent = data.online ? 'Connected' : 'Service Offline';

                    // YouTube (Added v2.9)
                    const yDot = document.getElementById('status-youtube-dot');
                    const yText = document.getElementById('status-youtube-text');
                    if (yDot) yDot.className = data.online ? 'dot on' : 'dot off';
                    if (yText) yText.textContent = data.online ? 'Connected' : 'Service Offline';
                })
                .catch(() => {
                    ['twitch', 'youtube'].forEach(p => {
                        const dot = document.getElementById('status-' + p + '-dot');
                        const text = document.getElementById('status-' + p + '-text');
                        if (dot) dot.className = 'dot off';
                        if (text) text.textContent = 'Service Offline';
                    });
                });
        }

        setInterval(checkPlatformStatus, 15000);
        checkPlatformStatus();

        async function refreshLocalIP() {
            const ip = await ipcRenderer.invoke('hue:get-ip');
            if (ip) {
                document.getElementById('local-ip').textContent = ip;
                document.getElementById('sidebar-local-ip').textContent = ip;
            }
        }

        ipcRenderer.on('hue:ip', (event, ip) => {
            document.getElementById('local-ip').textContent = ip;
            document.getElementById('sidebar-local-ip').textContent = ip;
        });

        // Init
        refreshLocalIP();
        loadBuiltinPatterns();
        loadCustomLocationList();
        loadPatternDB();
        updateTeamUIs();
    