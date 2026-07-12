# Premium Style Guide

A comprehensive guide to creating luxury, premium web experiences.

## Design Philosophy

### Premium vs Basic
- **Basic**: Functional, clean, straightforward
- **Premium**: Intentional, sophisticated, memorable

### Core Principles
1. **Attention to Detail**: Every pixel should feel intentional
2. **Smoothness**: 60fps animations, fluid transitions
3. **Depth**: Layered designs with visual hierarchy
4. **Emotion**: Designs that evoke feelings, not just information
5. **Performance**: Beauty without compromise

## Typography

### Scale
```
H1: 3rem / 48px / Bold / Leading 1.2
H2: 2.25rem / 36px / Semibold / Leading 1.3
H3: 1.75rem / 28px / Semibold / Leading 1.4
H4: 1.25rem / 20px / Medium / Leading 1.5
Body: 1rem / 16px / Regular / Leading 1.6
Small: 0.875rem / 14px / Regular / Leading 1.5
```

### Premium Fonts
- **Headings**: Playfair Display (serif), Inter (sans-serif)
- **Body**: Inter, Lato, Roboto

### Usage
- Use generous line heights for readability
- Mix font weights intentionally (bold headings, regular body)
- Consider letter spacing for premium feel

## Colors

### Palette
```css
/* Primary */
--primary-50: #f0f9ff;
--primary-100: #e0f2fe;
--primary-500: #0ea5e9;
--primary-600: #0284c7;
--primary-900: #0c4a6e;

/* Accent */
--accent-50: #f0fdf4;
--accent-100: #dcfce7;
--accent-500: #22c55e;
--accent-600: #16a34a;

/* Neutral */
--neutral-50: #fafafa;
--neutral-100: #f5f5f5;
--neutral-500: #737373;
--neutral-900: #18181b;

/* Luxury Dark */
--luxury-dark: #0a0a0a;
--luxury-darker: #050505;
```

### Usage
- Use 3-4 colors maximum per design
- Ensure high contrast ratios (WCAG AA)
- Consider color psychology for brand alignment

## Glass Morphism

### Premium Glass Effect
```css
.luxury-glass {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(30px) saturate(200%);
    -webkit-backdrop-filter: blur(30px) saturate(200%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    box-shadow: 
        0 8px 32px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

/* Dark Mode */
.luxury-glass-dark {
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(40px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 
        0 8px 32px rgba(0, 0, 0, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
```

### Usage
- Apply to cards, modals, overlays
- Use subtle borders (1px solid)
- Add subtle shadows for depth
- Ensure text contrast

## Animations

### Timing Functions
```css
/* Smooth Premium */
.cubic-smooth {
    transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}

/* Elegant Easing */
.cubic-elegant {
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

/* Bouncy */
.cubic-bouncy {
    transition-timing-function: cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
```

### Durations
- **Micro-interactions**: 150-200ms
- **Smooth transitions**: 300-400ms
- **Complex animations**: 600-800ms

### Common Patterns
```css
/* Fade In */
.fade-in {
    animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Scale Up */
.scale-up {
    animation: scaleUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes scaleUp {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
}

/* Float */
.float {
    animation: float 3s ease-in-out infinite;
}

@keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}
```

## Spacing

### Scale
```
xs: 0.25rem  (4px)
sm: 0.5rem   (8px)
md: 1rem     (16px)
lg: 1.5rem   (24px)
xl: 2rem     (32px)
2xl: 3rem    (48px)
3xl: 4rem    (64px)
4xl: 6rem    (96px)
```

### Layout
- Use generous spacing (2xl+ for sections)
- Consistent spacing throughout
- Negative space as design element

## Shadows

### Soft Shadows
```css
/* Soft Shadow */
.soft-shadow {
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

/* Deep Shadow */
.deep-shadow {
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
}

/* Colored Shadow */
.colored-shadow {
    box-shadow: 0 10px 30px rgba(14, 165, 233, 0.3);
}
```

## Gradients

### Premium Gradients
```css
/* Blue Gradient */
.gradient-blue {
    background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%);
}

/* Purple Gradient */
.gradient-purple {
    background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
}

/* Sunset Gradient */
.gradient-sunset {
    background: linear-gradient(135deg, #f97316 0%, #ec4899 100%);
}

/* Dark Gradient */
.gradient-dark {
    background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%);
}
```

## Micro-interactions

### Magnetic Buttons
```css
.magnetic-btn {
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.magnetic-btn:hover {
    transform: scale(1.05) translateY(-2px);
}
```

### Ripple Effect
```css
.ripple {
    position: relative;
    overflow: hidden;
}

.ripple::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at center, rgba(255,255,255,0.3) 0%, transparent 70%);
    opacity: 0;
    transform: scale(0);
    transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.ripple:hover::after {
    opacity: 1;
    transform: scale(1);
}
```

## Layout Patterns

### Premium Card
```css
.premium-card {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    padding: 2rem;
    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.premium-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
    border-color: rgba(255, 255, 255, 0.2);
}
```

### Section Spacing
```css
.section {
    padding: 6rem 0;
}

.section-alt {
    padding: 4rem 0;
    background: rgba(255, 255, 255, 0.02);
}
```

## Accessibility

### Contrast Ratios
- Minimum: 4.5:1 (WCAG AA)
- Enhanced: 7:1 (WCAG AAA)
- Use contrast checkers before finalizing

### Focus States
```css
:focus-visible {
    outline: 2px solid #0ea5e9;
    outline-offset: 2px;
}
```

## Performance

### Optimization
- Minimize repaints (avoid layout thrashing)
- Use transform/opacity for animations
- Use will-change sparingly
- Test on target devices

### Load Times
- Target: < 1.5s first contentful paint
- Target: < 3s time to interactive
- Optimize images (WebP/AVIF)

## Summary

### Premium Checklist
- [ ] Every pixel intentional
- [ ] 60fps animations
- [ ] Smooth transitions
- [ ] Generous spacing
- [ ] Glass morphism effects
- [ ] Premium shadows
- [ ] Sophisticated typography
- [ ] High contrast
- [ ] Responsive design
- [ ] Fast load times

### Remember
- Quality over quantity
- Detail over speed
- Emotion over functionality
- Performance over features
- Premium over basic

---

**Last Updated**: 2024
**Version**: 1.0
