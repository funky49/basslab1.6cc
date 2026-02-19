document.addEventListener('DOMContentLoaded', () => {
    const MIN_HZ = 25;
    const MAX_HZ = 75;

    let audioCtx = null;
    let activeOsc = null; 
    let activeGain = null;
    let lfoOsc = null;    
    let analyser = null;
    
    let melodyTimeouts = [];
    let vizRAF = null;
    let uiUpdateRAF = null;

    let isFirstAction = true;
    let currentMode = 'generator';
    let genSubMode = ''; // Starts empty, set on action
    let toneHz = 49;
    let isDraggingKnob = false;

    const headerWrapper = document.getElementById('headerTextWrapper');
    const headerOverlay = document.getElementById('initialHeaderOverlay');
    const headerBase = document.getElementById('headerBase');
    const headerFill = document.getElementById('headerFill');
    const waveCanvas = document.getElementById('waveCanvas');
    const toneArrow = document.getElementById('toneArrow');

    // Safe Context handling
    function getSafeContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function handleFirstAction() {
        if (!isFirstAction) return;
        isFirstAction = false;
        headerOverlay.style.display = 'none';
        headerWrapper.style.display = 'flex';
        toneArrow.style.display = 'none';
        updateHeaderUI(MIN_HZ, "Oobleck Dance Generator1.6e");
    }

    // --- GLOBAL STOP ---
    window.stopAll = function() {
        handleFirstAction();
        
        // Disconnect and stop oscillators/nodes
        if (activeOsc) { try { activeOsc.stop(); activeOsc.disconnect(); } catch(e){} activeOsc = null; }
        if (lfoOsc) { try { lfoOsc.stop(); lfoOsc.disconnect(); } catch(e){} lfoOsc = null; }
        if (activeGain) { try { activeGain.disconnect(); } catch(e){} activeGain = null; }
        
        // Clear timing and RAF
        melodyTimeouts.forEach(t => clearTimeout(t));
        melodyTimeouts = [];
        if (uiUpdateRAF) { cancelAnimationFrame(uiUpdateRAF); uiUpdateRAF = null; }
        if (vizRAF) { cancelAnimationFrame(vizRAF); vizRAF = null; }
        
        // Clear visuals
        const c = waveCanvas.getContext('2d');
        c.clearRect(0, 0, waveCanvas.width, waveCanvas.height);

        // Clear UI states
        document.querySelectorAll('.key.active').forEach(k => k.classList.remove('active'));
        document.querySelectorAll('.song-btn.playing').forEach(b => b.classList.remove('playing'));
        document.body.classList.remove('active-audio');
        
        updateHeaderUI(MIN_HZ, "Oobleck Dance Generator1.6e");
    };

    // --- VISUALIZER ---
    function updateHeaderUI(hz, text = null) {
        if (text) {
            headerBase.textContent = text;
            headerFill.textContent = text;
        }
        const pct = Math.max(0, Math.min(100, ((hz - MIN_HZ) / (MAX_HZ - MIN_HZ)) * 100));
        headerFill.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    }

    function startViz() {
        if (vizRAF) cancelAnimationFrame(vizRAF);
        if (!analyser) return;
        
        const ctx = waveCanvas.getContext('2d');
        const bufferLen = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLen);
        
        const dpr = window.devicePixelRatio || 1;
        const rect = waveCanvas.getBoundingClientRect();
        waveCanvas.width = rect.width * dpr;
        waveCanvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        function draw() {
            vizRAF = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(dataArray);
            
            ctx.clearRect(0, 0, rect.width, rect.height);
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#ff3b30'; 
            ctx.beginPath();
            
            const sliceWidth = rect.width / bufferLen;
            let x = 0;
            
            for(let i = 0; i < bufferLen; i++) {
                const v = dataArray[i] / 128.0;
                const y = v * (rect.height / 2);
                if(i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
                x += sliceWidth;
            }
            ctx.stroke();
        }
        draw();
    }

    // --- GENERATORS ---
    function startTone(hz) {
        stopAll();
        const ctx = getSafeContext();
        activeOsc = ctx.createOscillator();
        activeGain = ctx.createGain();
        analyser = ctx.createAnalyser();

        activeOsc.frequency.setValueAtTime(hz, ctx.currentTime);
        activeGain.gain.setValueAtTime(0.3, ctx.currentTime);

        activeOsc.connect(activeGain).connect(analyser).connect(ctx.destination);
        activeOsc.start();
        
        updateHeaderUI(hz, `Tone — ${hz.toFixed(1)} Hz`);
        startViz();
    }

    function startSweep(center, span, duration) {
        stopAll();
        const ctx = getSafeContext();
        
        activeOsc = ctx.createOscillator();
        activeGain = ctx.createGain();
        analyser = ctx.createAnalyser();
        lfoOsc = ctx.createOscillator();
        const lfoGain = ctx.createGain();

        activeOsc.frequency.value = center;
        lfoOsc.type = 'triangle';
        lfoOsc.frequency.value = 1 / duration; 
        lfoGain.gain.value = span; 
        
        lfoOsc.connect(lfoGain).connect(activeOsc.frequency);
        activeGain.gain.setValueAtTime(0.3, ctx.currentTime);
        activeOsc.connect(activeGain).connect(analyser).connect(ctx.destination);
        
        lfoOsc.start();
        activeOsc.start();
        
        updateHeaderUI(center, `Sweep ${center-span} to ${center+span}Hz`);
        startViz();
    }

    function playKey(freq, noteName) {
        handleFirstAction();
        startTone(freq); 
        updateHeaderUI(freq, `${noteName} — ${freq.toFixed(1)}Hz`);
    }

    window.playSong = (songId) => {
        stopAll();
        const btn = document.getElementById(`btn-${songId}`);
        if(btn) btn.classList.add('playing');
        
        const ctx = getSafeContext();
        const song = SONG_LIBRARY[songId];
        
        const loopSong = async () => {
            if(!btn.classList.contains('playing')) return; 
            for (let note of song.notes) {
                if(!btn.classList.contains('playing')) return; 
                
                let freq = 0;
                if (NOTES[note.n]) {
                    freq = NOTES[note.n] * Math.pow(2, (TRANSPOSE_SEMITONES + song.trim) / 12);
                }
                
                if (freq > 20) {
                    if(activeOsc) { try{activeOsc.stop();}catch(e){} }
                    activeOsc = ctx.createOscillator();
                    activeGain = ctx.createGain();
                    if(!analyser) analyser = ctx.createAnalyser();
                    
                    activeOsc.frequency.setValueAtTime(freq, ctx.currentTime);
                    activeGain.gain.setValueAtTime(0.2, ctx.currentTime);
                    activeGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (note.d/1000) - 0.05);
                    
                    activeOsc.connect(activeGain).connect(analyser).connect(ctx.destination);
                    activeOsc.start();
                    activeOsc.stop(ctx.currentTime + (note.d/1000));
                    
                    updateHeaderUI(freq, `${note.n} — ${freq.toFixed(1)}Hz`);
                    if(!vizRAF) startViz();
                }
                
                await new Promise(r => {
                    const t = setTimeout(r, note.d);
                    melodyTimeouts.push(t);
                });
            }
            if(btn.classList.contains('playing')) loopSong();
        };
        loopSong();
    };

    // Toy Mode Bass Drop/Rise Macros
    window.playSweep = (start, end) => {
        stopAll();
        const ctx = getSafeContext();
        analyser = ctx.createAnalyser();
        activeOsc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        activeOsc.frequency.setValueAtTime(start, ctx.currentTime);
        activeOsc.frequency.linearRampToValueAtTime(end, ctx.currentTime + 7);
        
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.2, ctx.currentTime + 6.9);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 7);
        
        activeOsc.connect(gain).connect(analyser).connect(ctx.destination);
        activeOsc.start();
        activeOsc.stop(ctx.currentTime + 7);
        document.body.classList.add('active-audio');
        startViz();

        let startTime = Date.now();
        const duration = 7000;
        function animateRampUI() {
            if(!activeOsc) return;
            let elapsed = Date.now() - startTime;
            if(elapsed > duration) { updateHeaderUI(MIN_HZ, "Oobleck Dance Generator1.6e"); return; }
            let pct = elapsed / duration;
            let currentF = start + (end - start) * pct;
            updateHeaderUI(currentF, start < end ? `Bass Rise — ${currentF.toFixed(0)}Hz` : `Bass Drop — ${currentF.toFixed(0)}Hz`);
            uiUpdateRAF = requestAnimationFrame(animateRampUI);
        }
        animateRampUI();
    };

    // --- UI ROUTING ---
    window.setMode = (mode) => {
        stopAll();
        currentMode = mode;
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${mode}`).classList.add('active');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-btn')[['generator','song','toy'].indexOf(mode)].classList.add('active');
        
        // Ensure Tone view resets completely on mode switch
        if(mode === 'generator' && !genSubMode) {
            toneArrow.style.display = isFirstAction ? 'block' : 'none';
        }
    };

    window.setGenSubMode = (sub) => {
        stopAll(); // Trigger global stop
        genSubMode = sub;
        document.querySelectorAll('.gen-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`btn-${sub}`).classList.add('active');
        document.querySelectorAll('.sub-ui').forEach(u => u.classList.remove('active'));
        document.getElementById(`ui-${sub}`).classList.add('active');
        toneArrow.style.display = 'none'; // Clear arrow if active

        if (sub === 'tone') {
            startTone(toneHz); 
        }
    };

    // --- TONE KNOB LOGIC ---
    const hzKnob = document.getElementById('hzKnob');
    let startY = 0;
    let initialHz = 49;

    const updateKnobUI = (hz) => {
        toneHz = Math.min(MAX_HZ, Math.max(MIN_HZ, hz));
        document.getElementById('toneVal').textContent = Math.round(toneHz);
        
        const pct = (toneHz - MIN_HZ) / (MAX_HZ - MIN_HZ);
        const deg = -135 + (pct * 270);
        document.querySelector('.knob-marker').style.transform = `translateX(-50%) rotate(${deg}deg)`;
        
        if (genSubMode === 'tone' && activeOsc && !lfoOsc) {
            activeOsc.frequency.setValueAtTime(toneHz, audioCtx ? audioCtx.currentTime : 0);
            updateHeaderUI(toneHz, `Tone — ${toneHz.toFixed(1)} Hz`);
        }
    };

    const startDrag = (y) => { 
        handleFirstAction();
        isDraggingKnob = true; startY = y; initialHz = toneHz; 
        if(genSubMode !== 'tone') setGenSubMode('tone');
    };
    const moveDrag = (y) => { if (!isDraggingKnob) return; const delta = startY - y; updateKnobUI(initialHz + (delta * 0.5)); };
    const endDrag = () => { isDraggingKnob = false; };

    hzKnob.addEventListener('mousedown', e => startDrag(e.clientY));
    document.addEventListener('mousemove', e => moveDrag(e.clientY));
    document.addEventListener('mouseup', endDrag);

    hzKnob.addEventListener('touchstart', e => { e.preventDefault(); startDrag(e.touches[0].clientY); });
    document.addEventListener('touchmove', e => { e.preventDefault(); moveDrag(e.touches[0].clientY); }, {passive: false});
    document.addEventListener('touchend', endDrag);

    document.getElementById('nudgeUp').onclick = () => { handleFirstAction(); updateKnobUI(toneHz + 1); if(genSubMode!=='tone') setGenSubMode('tone'); };
    document.getElementById('nudgeDown').onclick = () => { handleFirstAction(); updateKnobUI(toneHz - 1); if(genSubMode!=='tone') setGenSubMode('tone'); };

    // --- SWEEP LOGIC ---
    const swpCenter = document.getElementById('swpCenter');
    const swpSpan = document.getElementById('swpSpan');
    const swpTime = document.getElementById('swpTime');

    const updateSweepLabels = () => {
        document.getElementById('swpCenterVal').textContent = swpCenter.value;
        document.getElementById('swpSpanVal').textContent = swpSpan.value;
        document.getElementById('swpTimeVal').textContent = swpTime.value;
    };

    const triggerSweep = () => {
        handleFirstAction();
        startSweep(parseFloat(swpCenter.value), parseFloat(swpSpan.value), parseFloat(swpTime.value));
    };

    [swpCenter, swpSpan, swpTime].forEach(el => {
        el.addEventListener('input', updateSweepLabels);
    });
    
    // Auto-trigger on change of the Median slider as requested
    swpCenter.addEventListener('change', triggerSweep);

    // --- KEYBOARD BUILDER ---
    function buildKeys() {
        const wrap = document.getElementById('pianoWrapper');
        // A0 to A1 (13 keys)
        const keys = [
            {n:'A0', f:27.50, t:'w'}, {n:'A#0', f:29.14, t:'b'}, {n:'B0', f:30.87, t:'w'},
            {n:'C1', f:32.70, t:'w'}, {n:'C#1', f:34.65, t:'b'}, {n:'D1', f:36.71, t:'w'},
            {n:'D#1', f:38.89, t:'b'}, {n:'E1', f:41.20, t:'w'}, {n:'F1', f:43.65, t:'w'},
            {n:'F#1', f:46.25, t:'b'}, {n:'G1', f:49.00, t:'w'}, {n:'G#1', f:51.91, t:'b'},
            {n:'A1', f:55.00, t:'w'}
        ];

        let wCount = 0;
        keys.forEach(k => {
            const el = document.createElement('div');
            el.className = `key key-${k.t === 'w' ? 'white' : 'black'}`;
            if (k.t === 'w') { 
                el.style.left = `${wCount * 12.5}%`; 
                wCount++; 
            } else { 
                el.style.left = `${(wCount) * 12.5}%`; 
            }

            const play = (e) => { e.preventDefault(); el.classList.add('active'); playKey(k.f, k.n); };
            const stop = (e) => { e.preventDefault(); el.classList.remove('active'); stopAll(); };

            el.addEventListener('mousedown', play);
            el.addEventListener('mouseup', stop);
            el.addEventListener('mouseleave', stop);
            el.addEventListener('touchstart', play, {passive: false});
            el.addEventListener('touchend', stop);
            wrap.appendChild(el);
        });
    }

    // --- SONG BUILDER ---
    function buildSongs() {
        const grid = document.getElementById('songGrid');
        if (typeof SONG_LIBRARY === 'undefined') return;
        Object.keys(SONG_LIBRARY).forEach(k => {
            const btn = document.createElement('button');
            btn.className = 'song-btn';
            btn.id = `btn-${k}`;
            btn.textContent = SONG_LIBRARY[k].title;
            btn.onclick = () => { handleFirstAction(); playSong(k); };
            grid.appendChild(btn);
        });
    }

    buildKeys();
    buildSongs();
    updateKnobUI(49);
});