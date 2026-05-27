export class DotsBackground {
    constructor(containerId, imageUrl = '/img/fondo_dots.jpg') {
        this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
        if (!this.container) return;

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.dots = [];
        this.glitches = []; // Array to store active glitch blocks
        this.animationFrameId = null;
        this.lastWidth = 0;
        this.lastHeight = 0;
        
        // Image Analysis
        this.imageUrl = imageUrl;
        this.image = new Image();
        this.imageLoaded = false;
        this.imageCanvas = document.createElement('canvas');
        this.imageCtx = this.imageCanvas.getContext('2d');
        
        // Configuration
        this.spacing = 10; // Reduced spacing for higher resolution
        this.baseSize = 1; // Base size of squares
        this.maxSize = 7; // Maximum size of squares
        this.speed = 0.002; // Speed of the pulse
        
        this.init();
    }

    init() {
        // Insertar el canvas como primer hijo (después del ::before si existe)
        if (this.container.firstChild) {
            this.container.insertBefore(this.canvas, this.container.firstChild);
        } else {
            this.container.appendChild(this.canvas);
        }
        
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none'; 
        this.canvas.style.zIndex = '0'; 

        // Load image first
        this.image.onload = () => {
            this.imageLoaded = true;
            this.resize(); // Trigger initial draw
        };
        this.image.src = this.imageUrl;

        this.resize();
        
        // Listener para resize normal
        window.addEventListener('resize', () => this.resize());
        
        // Detectar cambios de zoom (visualViewport es más preciso)
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => this.resize());
        }
        
        this.animate();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.container.getBoundingClientRect();
        
        // Guardar dimensiones lógicas primero
        this.width = rect.width;
        this.height = rect.height;
        
        // Ajustar dimensiones internas del canvas
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        
        // IMPORTANTE: Obtener contexto fresco y re-escalar después de cambiar width/height
        this.ctx = this.canvas.getContext('2d');
        this.ctx.scale(dpr, dpr);
        
        // Reaplicar estilos críticos que pueden perderse
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.zIndex = '0';
        this.canvas.style.pointerEvents = 'none';
        
        if (this.imageLoaded) {
            // Resize image analysis canvas to match logical size
            // We draw the image to cover the area (like background-size: cover)
            this.imageCanvas.width = this.width;
            this.imageCanvas.height = this.height;
            
            // Calculate cover dimensions
            const scale = Math.max(this.width / this.image.width, this.height / this.image.height);
            const x = (this.width / 2) - (this.image.width / 2) * scale;
            const y = (this.height / 2) - (this.image.height / 2) * scale;
            
            this.imageCtx.drawImage(this.image, x, y, this.image.width * scale, this.image.height * scale);
            
            // Get pixel data for the whole area
            this.imageData = this.imageCtx.getImageData(0, 0, this.width, this.height).data;
        }

        this.createDots();
    }

    getBrightness(x, y) {
        if (!this.imageData) return 0;
        
        // Ensure coordinates are within bounds
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        
        if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return 0;

        const index = (iy * this.width + ix) * 4;
        const r = this.imageData[index];
        const g = this.imageData[index + 1];
        const b = this.imageData[index + 2];
        
        // Calculate perceived brightness (0-255)
        // Standard formula: 0.299*R + 0.587*G + 0.114*B
        const brightness = (0.299 * r + 0.587 * g + 0.114 * b);
        
        // Invert: we want darker areas to be bigger dots (or vice versa depending on style)
        // Assuming black dots on yellow background: darker image area -> bigger dot
        return 255 - brightness;
    }

    createDots() {
        this.dots = [];
        const cols = Math.ceil(this.width / this.spacing);
        const rows = Math.ceil(this.height / this.spacing);

        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
                const x = i * this.spacing; // Top-left for rect
                const y = j * this.spacing;
                
                // Sample brightness at center of the "cell"
                const centerX = x + this.spacing / 2;
                const centerY = y + this.spacing / 2;
                
                const brightness = this.imageLoaded ? this.getBrightness(centerX, centerY) : 0;
                
                // Map brightness to size factor
                // Threshold to create cleaner "blocks" of density
                let sizeFactor = Math.pow(brightness / 255, 2); 
                
                // Optional: Quantize sizes to reinforce the digital/blocky look
                // sizeFactor = Math.floor(sizeFactor * 4) / 4;

                this.dots.push({
                    col: i,
                    row: j,
                    x,
                    y,
                    centerX,
                    centerY,
                    sizeFactor, 
                    phase: Math.random() * Math.PI * 2 
                });
            }
        }
    }

    updateGlitches() {
        // Randomly add new glitches
        if (Math.random() < 0.02) { // 2% chance per frame
            const cols = Math.ceil(this.width / this.spacing);
            const rows = Math.ceil(this.height / this.spacing);
            
            const w = Math.floor(Math.random() * 10) + 2; // Width: 2-12 blocks
            const h = Math.floor(Math.random() * 10) + 2; // Height: 2-12 blocks
            const x = Math.floor(Math.random() * (cols - w));
            const y = Math.floor(Math.random() * (rows - h));
            
            this.glitches.push({
                x, y, w, h,
                densityMod: (Math.random() - 0.5) * 2, // -1 to 1
                startTime: Date.now(),
                duration: Math.random() * 1000 + 500 // 0.5s - 1.5s
            });
        }

        // Remove expired glitches
        const now = Date.now();
        this.glitches = this.glitches.filter(g => now - g.startTime < g.duration);
    }

    animate(timestamp) {
        if (!timestamp) timestamp = 0;
        
        // Verificar si el contenedor cambió de tamaño (por zoom u otro motivo)
        const rect = this.container.getBoundingClientRect();
        if (Math.abs(rect.width - this.lastWidth) > 1 || Math.abs(rect.height - this.lastHeight) > 1) {
            this.lastWidth = rect.width;
            this.lastHeight = rect.height;
            this.resize();
        }
        
        this.updateGlitches();

        this.ctx.clearRect(0, 0, this.width, this.height);
        // Use a dark grey with slight transparency for better blending
        this.ctx.fillStyle = 'rgba(28, 28, 28, 0.55)'; 
        
        const now = Date.now();

        this.dots.forEach(dot => {
            let targetSize = this.baseSize;
            let glitchMod = 0;

            // Check active glitches
            // Optimization: loop glitches only if we have any
            if (this.glitches.length > 0) {
                for (const glitch of this.glitches) {
                    if (dot.col >= glitch.x && dot.col < glitch.x + glitch.w &&
                        dot.row >= glitch.y && dot.row < glitch.y + glitch.h) {
                        
                        // Fade in/out effect for glitch
                        const age = now - glitch.startTime;
                        const life = age / glitch.duration;
                        const fade = Math.sin(life * Math.PI); // 0 -> 1 -> 0
                        
                        glitchMod += glitch.densityMod * fade * this.maxSize;
                    }
                }
            }
            
            if (this.imageLoaded) {
                targetSize = this.baseSize + (this.maxSize - this.baseSize) * dot.sizeFactor;
            }

            // Combine all factors
            let finalSize = targetSize + glitchMod;

            // Pulse affects size subtly
            const pulse = Math.sin(timestamp * this.speed + dot.phase) * 0.5;
            finalSize = Math.max(0.5, finalSize + pulse);
            
            // Clamp to reasonable limits
            finalSize = Math.min(this.spacing - 1, Math.max(0.5, finalSize));

            // Center the square within its grid cell
            const offset = (this.spacing - finalSize) / 2;
            
            if (finalSize > 0.5) {
                this.ctx.fillRect(dot.x + offset, dot.y + offset, finalSize, finalSize);
            }
        });

        this.animationFrameId = requestAnimationFrame((t) => this.animate(t));
    }

    destroy() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        window.removeEventListener('resize', () => this.resize());
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
    }
}
