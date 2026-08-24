# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is Joshua Motoaki Lau's personal website built with Astro. It's a visually creative portfolio site featuring animated color bars, SVG noise effects, and bilingual content (English/Japanese). The site has a distinctive artistic design with custom typography and animations.

## Common Development Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

## Architecture

### Stack

- **Framework**: Astro 5.x with TypeScript
- **Styling**: Tailwind CSS 4.x with custom CSS variables and animations
- **Fonts**: PP Editorial New (custom) + Noto Serif JP for Japanese characters
- **Build**: Vite with Tailwind plugin

### Key Structure

- **Layout**: `BaseLayout.astro` handles the core HTML structure and global styles
- **Components**: `Header.astro` includes navigation and an interactive about modal
- **Styling**: Custom design system in `global.css` with semantic color variables and typography scales
- **Typography**: Mixed font system supporting both Latin and Japanese characters (`.zh` class)

### Concrete Poetry editor (`/poetry`)

A Svelte 5 (runes) motion-graphics editor for text-on-shape poems:

- `src/lib/poetry/` — pure engine modules: `types.ts` (document model: keyframes/poses, motion settings), `geometry.ts` (paths, resampling, cyclic matching), `layout.ts` (token placement on outline/fill), `motion.ts` (segment plans, N-keyframe interpolation, stagger, enter/exit), `easing.ts`, `tools.ts` (translate/scale/rotate/bend/warp), `export.ts` (static + baked-animation SVG markup)
- `src/lib/poetry/editorState.svelte.ts` — shared runes state class: document, selection, playback loop, undo/redo history, localStorage autosave, segment-plan cache
- `src/components/PoetryEditor.svelte` — shell: header/exports, sidebar (words/build/colors), keyboard shortcuts
- `src/components/poetry/Stage.svelte` — canvas: direct manipulation (move/scale/rotate box, draw, bend lasso+pivot, sculpt brush), onion-skin ghosts, floating tool rail
- `src/components/poetry/Timeline.svelte` — playback bar: scrub, draggable pose diamonds, per-segment easing popover, loop modes, flow (stagger/enter-style/trigger) popover
- `src/components/poetry/ImageShapeTool.svelte` — image-to-shape modal (MediaPipe segmenter worker + d3-contour)

The motion model is pose-to-pose: a document always has ≥1 keyframe; ≥2 keyframes means animated. Bend/warp are shape tools that edit a pose, not motion types.

### Design System

- Color palette with semantic names (`red-std`, `orange-std`, etc.)
- Typography scale from `text-h6` to `text-huge`
- Animation system for growing bars and character fade-ins
- SVG noise filters for texture effects

### Code Conventions

- Astro components use frontmatter for logic
- Custom CSS in `<style>` blocks for component-specific styles
- Tailwind classes for utility styling
- Japanese text uses `.zh` class for proper font rendering
- Responsive design with mobile-first approach

## Development Notes

- The site features complex CSS animations for the colored bars and character reveals
- SVG filters create noise texture overlays
- About modal is implemented as an overlay with backdrop blur
- Custom font loading via `/public/fonts/`
- The empty `pomodoro.astro` page suggests planned functionality

## Linting & Formatting

The project uses Prettier with Astro plugin and has pre-commit hooks via Husky and lint-staged for automatic formatting.
