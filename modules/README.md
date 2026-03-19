# OpenLens Modules

This directory contains the modular architecture of OpenLens, breaking down the monolithic `app.js` into organized, maintainable modules.

## Structure

```
modules/
├── core/
│   ├── state.js          # Shared application state
│   ├── dom.js            # DOM element references
│   └── utils.js          # Utility functions (image loading, canvas operations, etc.)
├── tools/
│   ├── crop.js           # Crop tool functionality
│   ├── resize.js         # Resize tool with Pica integration
│   ├── rotate.js         # Rotation operations
│   ├── convert.js        # Format conversion (PNG/JPEG/WebP)
│   ├── background-removal.js  # AI-powered background removal
│   └── text-overlay.js   # Text Behind Object feature with Fabric.js
├── file-handler.js       # File loading, history management, undo/redo
└── ui-controller.js      # UI state management, view switching, canvas fitting
```

## Module Responsibilities

### Core Modules

- **state.js**: Central state management for the entire application
- **dom.js**: All DOM element references in one place
- **utils.js**: Shared utilities like image loading, blob conversion, status updates

### Tool Modules

Each tool module exports:
- Main operation function (e.g., `applyCrop`, `applyResize`)
- Initialization function for event listeners (e.g., `initCropListeners`)
- Tool-specific helper functions

### Supporting Modules

- **file-handler.js**: Manages file loading, history stack, undo/redo operations
- **ui-controller.js**: Handles view switching, canvas fitting, tool activation

## Usage in app.js

The main `app.js` file now acts as an orchestrator:

```javascript
import { initCropListeners } from "./modules/tools/crop.js";
import { initResizeListeners } from "./modules/tools/resize.js";
// ... other imports

// Initialize all tools
initCropListeners(commitBlobWithRender);
initResizeListeners(commitBlobWithRender);
// ... etc
```

## Benefits

1. **Separation of Concerns**: Each tool is isolated in its own module
2. **Maintainability**: Easy to locate and modify specific functionality
3. **Testability**: Individual modules can be tested in isolation
4. **Scalability**: New tools can be added without touching existing code
5. **Code Reuse**: Shared utilities are centralized in core modules

## Adding a New Tool

1. Create a new file in `modules/tools/your-tool.js`
2. Export the main operation function and init function
3. Import and initialize in `app.js`
4. Add UI controls in `index.html`
