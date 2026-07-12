# Advanced Technology Patterns

Cutting-edge patterns and techniques for premium web experiences.

## Three.js Integration

### Particle Backgrounds
```javascript
// Premium particle system
class ParticleBackground {
    constructor(container, options = {}) {
        this.container = container;
        this.count = options.count || 100;
        this.size = options.size || 2;
        this.speed = options.speed || 0.5;
        this.colors = options.colors || ['#0ea5e9', '#6366f1', '#a855f7'];
        this.init();
    }

    init() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            75,
            this.container.offsetWidth / this.container.offsetHeight,
            0.1,
            1000
        );
        this.camera.position.z = 50;

        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
        this.container.appendChild(this.renderer.domElement);

        this.createParticles();
        this.animate();

        window.addEventListener('resize', () => this.onResize());
    }

    createParticles() {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(this.count * 3);
        const velocities = [];

        for (let i = 0; i < this.count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 100;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 50;
            velocities.push({
                x: (Math.random() - 0.5) * this.speed,
                y: (Math.random() - 0.5) * this.speed,
                z: (Math.random() - 0.5) * this.speed
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            size: this.size,
            color: this.colors[0],
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);
        this.velocities = velocities;
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const positions = this.particles.geometry.attributes.position.array;

        for (let i = 0; i < this.count; i++) {
            positions[i * 3] += this.velocities[i].x;
            positions[i * 3 + 1] += this.velocities[i].y;
            positions[i * 3 + 2] += this.velocities[i].z;

            // Boundary check
            if (Math.abs(positions[i * 3]) > 50) positions[i * 3] *= -0.9;
            if (Math.abs(positions[i * 3 + 1]) > 50) positions[i * 3 + 1] *= -0.9;
            if (Math.abs(positions[i * 3 + 2]) > 25) positions[i * 3 + 2] *= -0.9;
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.rotation.y += 0.001;
        this.particles.rotation.x += 0.0005;

        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        this.camera.aspect = this.container.offsetWidth / this.container.offsetHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
    }

    destroy() {
        this.renderer.dispose();
        this.container.innerHTML = '';
    }
}
```

### Interactive 3D Product Showcase
```javascript
class ProductShowcase3D {
    constructor(container, productData) {
        this.container = container;
        this.productData = productData;
        this.init();
    }

    init() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            45,
            this.container.offsetWidth / this.container.offsetHeight,
            0.1,
            1000
        );
        this.camera.position.z = 5;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        this.createProduct();
        this.createLights();
        this.addEventListeners();
        this.animate();
    }

    createProduct() {
        const geometry = new THREE.TorusKnotGeometry(1, 0.3, 128, 32);
        const material = new THREE.MeshPhysicalMaterial({
            color: this.productData.color,
            metalness: 0.9,
            roughness: 0.1,
            clearcoat: 1.0,
            clearcoatRoughness: 0.1,
            transmission: 0.2
        });

        this.product = new THREE.Mesh(geometry, material);
        this.scene.add(this.product);
    }

    createLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 5, 5);
        this.scene.add(directionalLight);

        const pointLight = new THREE.PointLight(this.productData.color, 2, 10);
        pointLight.position.set(-2, 3, 2);
        this.scene.add(pointLight);
    }

    addEventListeners() {
        let isDragging = false;
        let previousMousePosition = { x: 0, y: 0 };

        this.container.addEventListener('mousedown', (e) => {
            isDragging = true;
        });

        this.container.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const deltaMove = {
                    x: e.offsetX - previousMousePosition.x,
                    y: e.offsetY - previousMousePosition.y
                };

                this.product.rotation.y += deltaMove.x * 0.01;
                this.product.rotation.x += deltaMove.y * 0.01;
            }
            previousMousePosition = { x: e.offsetX, y: e.offsetY };
        });

        this.container.addEventListener('mouseup', () => {
            isDragging = false;
        });

        this.container.addEventListener('mouseleave', () => {
            isDragging = false;
        });

        window.addEventListener('resize', () => this.onResize());
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (!this.isDragging) {
            this.product.rotation.y += 0.005;
        }

        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        this.camera.aspect = this.container.offsetWidth / this.container.offsetHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
    }

    setColor(color) {
        this.productData.color = color;
        this.product.material.color.set(color);
    }

    destroy() {
        this.renderer.dispose();
        this.container.innerHTML = '';
    }
}
```

## WebGL Performance Optimization

### Render Optimization
```javascript
class OptimizedRenderer {
    constructor(container) {
        this.container = container;
        this.init();
    }

    init() {
        // Limit pixel ratio for performance
        const pixelRatio = Math.min(window.devicePixelRatio, 2);

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance',
            pixelRatio: pixelRatio
        });

        this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setPixelRatio(pixelRatio);

        this.container.appendChild(this.renderer.domElement);
    }

    // Batch rendering for multiple objects
    renderBatch(objects, material) {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];

        objects.forEach(obj => {
            positions.push(
                obj.x, obj.y, obj.z,
                obj.x + obj.width, obj.y, obj.z,
                obj.x, obj.y + obj.height, obj.z,
                obj.x + obj.width, obj.y + obj.height, obj.z
            );

            obj.colors.forEach(color => {
                colors.push(color.r, color.g, color.b);
            });
        });

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const mesh = new THREE.Mesh(geometry, material);
        this.renderer.render(this.scene, this.camera);
    }
}
```

## Advanced CSS Techniques

### CSS Custom Properties
```css
:root {
    /* Colors */
    --color-primary: #0ea5e9;
    --color-primary-dark: #0284c7;
    --color-secondary: #6366f1;

    /* Spacing */
    --spacing-xs: 0.25rem;
    --spacing-sm: 0.5rem;
    --spacing-md: 1rem;
    --spacing-lg: 1.5rem;
    --spacing-xl: 2rem;

    /* Typography */
    --font-heading: 'Playfair Display', serif;
    --font-body: 'Inter', sans-serif;

    /* Animation */
    --ease-smooth: cubic-bezier(0.16, 1, 0.3, 1);
    --ease-elegant: cubic-bezier(0.4, 0, 0.2, 1);
    --ease-bouncy: cubic-bezier(0.68, -0.55, 0.265, 1.55);

    /* Transitions */
    --transition-fast: 150ms var(--ease-smooth);
    --transition-normal: 300ms var(--ease-smooth);
    --transition-slow: 600ms var(--ease-elegant);
}
```

### Backdrop Filter
```css
/* Premium backdrop filters */
.backdrop-blur-sm {
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
}

.backdrop-blur-md {
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
}

.backdrop-blur-lg {
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
}

/* Combined blur and saturation */
.backdrop-saturate {
    backdrop-filter: blur(20px) saturate(200%);
    -webkit-backdrop-filter: blur(20px) saturate(200%);
}
```

### CSS Grid Layouts
```css
/* Premium Grid System */
.grid-premium {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 2rem;
    align-items: start;
}

.grid-masonry {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-auto-rows: 200px;
    gap: 1.5rem;
    grid-auto-flow: dense;
}

.grid-item-wide {
    grid-column: span 2;
    grid-row: span 2;
}

.grid-item-tall {
    grid-row: span 2;
}
```

## Modern JavaScript Patterns

### Reactive State Management
```javascript
class ReactiveStore {
    constructor(initialState) {
        this.state = initialState;
        this.listeners = new Set();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    setState(updater) {
        this.state = typeof updater === 'function'
            ? updater(this.state)
            : { ...this.state, ...updater };

        this.listeners.forEach(listener => listener(this.state));
    }

    get() {
        return this.state;
    }
}

// Usage
const store = new ReactiveStore({
    theme: 'light',
    cart: [],
    user: null
});

store.subscribe((state) => {
    console.log('State changed:', state);
});

store.setState({ theme: 'dark' });
```

### Async Data Fetching with Caching
```javascript
class DataService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    async fetch(url, options = {}) {
        const cached = this.cache.get(url);
        const now = Date.now();

        // Return cached data if valid
        if (cached && now - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        // Fetch new data
        const response = await fetch(url, options);
        const data = await response.json();

        // Cache the result
        this.cache.set(url, {
            data,
            timestamp: now
        });

        return data;
    }

    clearCache() {
        this.cache.clear();
    }

    invalidateCache(url) {
        if (url) {
            this.cache.delete(url);
        } else {
            this.cache.clear();
        }
    }
}
```

## Performance Patterns

### Intersection Observer for Lazy Loading
```javascript
class LazyLoader {
    constructor(options = {}) {
        this.options = {
            rootMargin: options.rootMargin || '200px',
            threshold: options.threshold || 0.01
        };
        this.init();
    }

    init() {
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.load(entry.target);
                    this.observer.unobserve(entry.target);
                }
            });
        }, this.options);
    }

    load(element) {
        const src = element.dataset.src;
        const type = element.dataset.type || 'image';

        if (type === 'image') {
            element.src = src;
        } else if (type === 'iframe') {
            element.src = src;
        }

        element.classList.add('loaded');
    }

    observe(element) {
        this.observer.observe(element);
    }

    disconnect() {
        this.observer.disconnect();
    }
}
```

### Debounce and Throttle
```javascript
// Debounce - wait until function is no longer called
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle - limit function calls
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Usage
const handleScroll = throttle(() => {
    console.log('Scrolling...');
}, 100);

window.addEventListener('scroll', handleScroll);
```

## Summary

### Key Patterns
1. **Three.js Integration**: Particle systems, 3D products, performance optimization
2. **WebGL Performance**: Limit pixel ratio, batch rendering, efficient geometry
3. **Advanced CSS**: Custom properties, backdrop filters, grid layouts
4. **Modern JS**: Reactive state, async patterns, lazy loading
5. **Performance**: Debounce/throttle, intersection observer, caching

### Performance Checklist
- [ ] Use Web Workers for heavy computation
- [ ] Limit pixel ratio to 1-2
- [ ] Batch render multiple objects
- [ ] Use requestAnimationFrame for animations
- [ ] Implement lazy loading
- [ ] Cache API responses
- [ ] Optimize CSS animations
- [ ] Minimize layout thrashing
- [ ] Use transform/opacity for animations
- [ ] Test on target devices

---

**Last Updated**: 2024
**Version**: 1.0
