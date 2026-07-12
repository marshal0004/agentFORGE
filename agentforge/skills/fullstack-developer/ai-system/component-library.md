# Component Library Reference

Comprehensive reference for FluxUI components and usage patterns.

## Available Components

### Cards
- `flux:card` - Container component with shadow and border radius
- `flux:card-header` - Header section for cards
- `flux:card-body` - Main content area
- `flux:card-footer` - Footer section with actions

### Forms
- `flux:input` - Text input field
- `flux:textarea` - Multi-line text input
- `flux:select` - Dropdown select
- `flux:checkbox` - Checkbox input
- `flux:radio` - Radio button group
- `flux:switch` - Toggle switch
- `flux:slider` - Range slider
- `flux:file-upload` - File upload component
- `flux:form-group` - Form field wrapper
- `flux:form-label` - Form label
- `flux:form-error` - Error message display

### Buttons
- `flux:button` - Primary action button
- `flux:button-secondary` - Secondary button
- `flux:button-ghost` - Ghost button
- `flux:button-link` - Link-style button
- `flux:button-icon` - Icon button
- `flux:button-group` - Button group container

### Navigation
- `flux:navbar` - Top navigation bar
- `flux:navbar-brand` - Logo/brand section
- `flux:navbar-menu` - Navigation menu
- `flux:navbar-item` - Single menu item
- `flux:navbar-dropdown` - Dropdown menu
- `flux:breadcrumb` - Breadcrumb navigation
- `flux:pagination` - Pagination controls

### Layout
- `flux:container` - Container with max-width
- `flux:grid` - CSS Grid layout
- `flux:row` - Grid row
- `flux:col` - Grid column
- `flux:section` - Section container
- `flux:card` - Card component

### Typography
- `flux:heading` - Heading component
- `flux:paragraph` - Paragraph text
- `flux:small` - Small text
- `flux:blockquote` - Blockquote
- `flux:list` - List component
- `flux:list-item` - List item
- `flux:code` - Code block
- `flux:pre` - Preformatted text

### Feedback
- `flux:badge` - Badge/tag component
- `flux:tooltip` - Tooltip component
- `flux:popover` - Popover component
- `flux:dropdown` - Dropdown menu
- `flux:dropdown-item` - Dropdown item
- `flux:dropdown-divider` - Dropdown divider
- `flux:dropdown-header` - Dropdown header
- `flux:alert` - Alert message
- `flux:alert-success` - Success alert
- `flux:alert-error` - Error alert
- `flux:alert-warning` - Warning alert
- `flux:alert-info` - Info alert

### Data Display
- `flux:table` - Table component
- `flux:table-header` - Table header
- `flux:table-row` - Table row
- `flux:table-cell` - Table cell
- `flux:avatar` - Avatar component
- `flux:avatar-group` - Avatar group
- `flux:progress` - Progress bar
- `flux:progress-bar` - Individual progress bar
- `flux:progress-circle` - Circular progress

### Modals & Overlays
- `flux:modal` - Modal dialog
- `flux:modal-backdrop` - Modal backdrop
- `flux:modal-header` - Modal header
- `flux:modal-body` - Modal body
- `flux:modal-footer` - Modal footer
- `flux:drawer` - Drawer panel
- `flux:drawer-backdrop` - Drawer backdrop
- `flux:drawer-header` - Drawer header
- `flux:drawer-body` - Drawer body
- `flux:drawer-footer` - Drawer footer
- `flux:dialog` - Dialog component

### Media
- `flux:image` - Image component
- `flux:image-placeholder` - Image placeholder
- `flux:video` - Video component
- `flux:audio` - Audio player
- `flux:iframe` - Iframe component
- `flux:embed` - Embed component

### Icons
- `flux:icon` - Icon wrapper
- `flux:icon-check` - Checkmark icon
- `flux:icon-close` - Close icon
- `flux:icon-menu` - Menu icon
- `flux:icon-search` - Search icon
- `flux:icon-user` - User icon
- `flux:icon-settings` - Settings icon
- `flux:icon-heart` - Heart icon
- `flux:icon-star` - Star icon
- `flux:icon-arrow-right` - Arrow right icon
- `flux:icon-arrow-left` - Arrow left icon
- `flux:icon-chevron-down` - Chevron down icon
- `flux:icon-chevron-up` - Chevron up icon
- `flux:icon-chevron-right` - Chevron right icon
- `flux:icon-chevron-left` - Chevron left icon
- `flux:icon-plus` - Plus icon
- `flux:icon-minus` - Minus icon
- `flux:icon-info` - Info icon
- `flux:icon-warning` - Warning icon
- `flux:icon-error` - Error icon
- `flux:icon-success` - Success icon
- `flux:icon-loading` - Loading icon
- `flux:icon-spinner` - Spinner icon
- `flux:icon-check-circle` - Check circle icon
- `flux:icon-times-circle` - Times circle icon

## Usage Patterns

### Premium Card
```html
<flux:card class="luxury-glass hover:scale-105 transition-all duration-300">
    <flux:card-header>
        <flux:heading size="lg" class="gradient-text">Premium Content</flux:heading>
    </flux:card-header>
    <flux:card-body>
        <flux:text class="opacity-80">
            With sophisticated styling and premium effects
        </flux:text>
    </flux:card-body>
    <flux:card-footer>
        <flux:button variant="secondary">Learn More</flux:button>
    </flux:card-footer>
</flux:card>
```

### Form with Validation
```html
<flux:form-group>
    <flux:form-label>Email Address</flux:form-label>
    <flux:input type="email" placeholder="Enter your email" />
    <flux:form-error>Invalid email format</flux:form-error>
</flux:form-group>
```

### Navigation Bar
```html
<flux:navbar>
    <flux:navbar-brand>
        <flux:heading size="lg">Brand</flux:heading>
    </flux:navbar-brand>
    <flux:navbar-menu>
        <flux:navbar-item active>Home</flux:navbar-item>
        <flux:navbar-item>Features</flux:navbar-item>
        <flux:navbar-item>Pricing</flux:navbar-item>
        <flux:navbar-item>About</flux:navbar-item>
    </flux:navbar-menu>
    <flux:navbar-menu>
        <flux:button variant="primary">Sign In</flux:button>
    </flux:navbar-menu>
</flux:navbar>
```

### Modal with Animation
```html
<flux:modal v-model="isModalOpen" class="modal-animation">
    <flux:modal-header>
        <flux:heading size="lg">Premium Modal</flux:heading>
    </flux:modal-header>
    <flux:modal-body>
        <flux:text>This modal features smooth animations and premium styling.</flux:text>
    </flux:modal-body>
    <flux:modal-footer>
        <flux:button variant="ghost" @click="isModalOpen = false">Cancel</flux:button>
        <flux:button variant="primary" @click="handleSubmit">Confirm</flux:button>
    </flux:modal-footer>
</flux:modal>
```

### Table with Styling
```html
<flux:table class="premium-table">
    <flux:table-header>
        <flux:table-row>
            <flux:table-cell>Name</flux:table-cell>
            <flux:table-cell>Email</flux:table-cell>
            <flux:table-cell>Status</flux:table-cell>
            <flux:table-cell>Actions</flux:table-cell>
        </flux:table-row>
    </flux:table-header>
    <flux:table-body>
        <flux:table-row v-for="user in users" :key="user.id">
            <flux:table-cell>{{ user.name }}</flux:table-cell>
            <flux:table-cell>{{ user.email }}</flux:table-cell>
            <flux:table-cell>
                <flux:badge :variant="user.status === 'active' ? 'success' : 'error'">
                    {{ user.status }}
                </flux:badge>
            </flux:table-cell>
            <flux:table-cell>
                <flux:button-group>
                    <flux:button variant="ghost" size="sm">Edit</flux:button>
                    <flux:button variant="ghost" size="sm">Delete</flux:button>
                </flux:button-group>
            </flux:table-cell>
        </flux:table-row>
    </flux:table-body>
</flux:table>
```

### Progress Indicator
```html
<flux:progress :value="75" :max="100" class="premium-progress">
    <flux:progress-bar>
        <flux:badge variant="primary">75% Complete</flux:badge>
    </flux:progress-bar>
</flux:progress>
```

### Avatar Group
```html
<flux:avatar-group :max="5">
    <flux:avatar src="/avatars/1.jpg" />
    <flux:avatar src="/avatars/2.jpg" />
    <flux:avatar src="/avatars/3.jpg" />
    <flux:avatar>+{{ users.length - 3 }}</flux:avatar>
</flux:avatar-group>
```

### Alert Component
```html
<flux:alert variant="success">
    <flux:icon icon="check-circle" />
    <flux:text>Operation completed successfully!</flux:text>
</flux:alert>

<flux:alert variant="error">
    <flux:icon icon="times-circle" />
    <flux:text>An error occurred. Please try again.</flux:text>
</flux:alert>

<flux:alert variant="warning">
    <flux:icon icon="warning" />
    <flux:text>This action cannot be undone.</flux:text>
</flux:alert>

<flux:alert variant="info">
    <flux:icon icon="info" />
    <flux:text>Here's some information for you.</flux:text>
</flux:alert>
```

### Button Variants
```html
<flux:button variant="primary">Primary</flux:button>
<flux:button variant="secondary">Secondary</flux:button>
<flux:button variant="ghost">Ghost</flux:button>
<flux:button variant="link">Link</flux:button>
<flux:button variant="outline">Outline</flux:button>
<flux:button variant="danger">Danger</flux:button>
<flux:button variant="success">Success</flux:button>
```

### Icon Usage
```html
<flux:icon icon="search" size="sm" />
<flux:icon icon="user" size="md" />
<flux:icon icon="settings" size="lg" />
<flux:icon icon="heart" size="xl" filled />
<flux:icon icon="loading" spin />
```

## Component Combinations

### Premium Dashboard Card
```html
<flux:card class="dashboard-card glass-effect">
    <flux:card-header>
        <flux:heading size="lg">Revenue Overview</flux:heading>
        <flux:button variant="ghost" size="sm">
            <flux:icon icon="more-horizontal" />
        </flux:button>
    </flux:card-header>
    <flux:card-body>
        <flux:heading size="3xl" class="gradient-text">$124,500</flux:heading>
        <flux:text class="text-success">+12.5% from last month</flux:text>
    </flux:card-body>
    <flux:card-footer>
        <flux:button variant="secondary">View Details</flux:button>
    </flux:card-footer>
</flux:card>
```

### Search Bar with Icons
```html
<div class="search-container">
    <flux:icon icon="search" class="search-icon" />
    <flux:input 
        type="text" 
        placeholder="Search..." 
        class="search-input"
    />
    <flux:button variant="ghost" size="sm">
        <flux:icon icon="mic" />
    </flux:button>
</div>
```

### Navigation with Dropdown
```html
<flux:navbar>
    <flux:navbar-brand>
        <flux:heading size="lg">Brand</flux:heading>
    </flux:navbar-brand>
    <flux:navbar-menu>
        <flux:navbar-item active>Home</flux:navbar-item>
        <flux:navbar-item>Features</flux:navbar-item>
        <flux:navbar-dropdown>
            <flux:dropdown-item>Pricing</flux:dropdown-item>
            <flux:dropdown-item>Documentation</flux:dropdown-item>
            <flux:dropdown-item>Support</flux:dropdown-item>
            <flux:dropdown-divider />
            <flux:dropdown-header>Company</flux:dropdown-header>
            <flux:dropdown-item>About</flux:dropdown-item>
            <flux:dropdown-item>Careers</flux:dropdown-item>
        </flux:navbar-dropdown>
    </flux:navbar-menu>
    <flux:navbar-menu>
        <flux:button variant="primary">Get Started</flux:button>
    </flux:navbar-menu>
</flux:navbar>
```

## Best Practices

### Accessibility
- Always use semantic HTML tags
- Add ARIA labels for interactive elements
- Ensure proper keyboard navigation
- Test with screen readers
- Maintain proper contrast ratios

### Performance
- Lazy load images and components
- Use proper image formats (WebP, AVIF)
- Minimize component re-renders
- Use virtualization for large lists
- Implement proper caching strategies

### Responsiveness
- Test on all device sizes
- Use responsive grid layouts
- Ensure touch targets are at least 44x44px
- Consider mobile-first approach
- Test on various browsers

### Theming
- Use CSS custom properties for colors
- Implement dark/light mode support
- Create consistent spacing scale
- Use consistent typography
- Maintain design system consistency

---

**Last Updated**: 2024
**Version**: 1.0
**Reference**: https://fluxui.dev/docs
