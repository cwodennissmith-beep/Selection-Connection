# Selection-Connection Maintenance Guide

## File Structure

```
Selection-Connection/
  index.html           Landing page (marketing, pricing, features)
  configurator.html    Cabinet configurator (3000+ lines, single-file app)
  lamiform.html        LamiForm decorative parts configurator
  buyer.html           Consumer-facing info page ("I'm a Buyer")
  ChassisPresets.json  Standalone preset data (for GH interop)
  MAINTENANCE.md       This file
```

## How to Add a New Chassis Preset

1. Open `configurator.html`
2. Find `const CHASSIS_PRESETS = {` (around line 984)
3. Add a new entry before the closing `};`:

```javascript
"My New Cabinet": {
  Width: 36, Height: 34.5, Depth: 24,
  DoorCount: 2, DrawerCount: 0, ShelfCount: 1,
  ToeKickHeight: 4, ToeKickDepth: 3,
  SideThickness: 0.75, BottomThickness: 0.75,
  BackPanelThickness: 0.25
},
```

4. Also add the same preset to `ChassisPresets.json` for GH definition compatibility
5. The preset will automatically appear in the dropdown — no other code changes needed

**Available keys:** Any slider key from `SLIDER_GROUPS` can be used in a preset. Common ones:
- `Width`, `Height`, `Depth` (required)
- `DoorCount`, `DrawerCount`, `ShelfCount`
- `ToeKickHeight`, `ToeKickDepth`
- `SideThickness`, `BottomThickness`, `BackPanelThickness`, `ShelfThickness`
- `DoorOverlayLeft/Right/Top/Bottom`, `DoorGap`, `DoorThickness`
- `DrawerHeight`, `DrawerBoxHeight`, `DrawerClearance`, `DrawerBoxSideThickness`
- `ShelfSetback`, `DadoDepth`

---

## How to Add a New Hardware Item

1. Open `configurator.html`
2. Find `const HARDWARE_LIBRARY = {` (around line 1086)
3. Add to the appropriate array (`hinges`, `slides`, or `pulls`):

```javascript
{ id: "HG-099", label: "Brand Model Description", brand: "Brand", model: "ModelNum", price: 3.50,
  params: { HingeCupDiameter: 1.378, HingeCupDepth: 0.512, HingeBoringDistance: 0.197 } },
```

**For hinges**, `params` keys are: `HingeCupDiameter`, `HingeCupDepth`, `HingeBoringDistance`
**For slides**, `params` keys are: `DrawerClearance`, `SlideTopClearance`, `SlideBottomClearance`
**For pulls**, `params` keys are: `PullBoreSpacing`, `PullMountingHoleDia`

All measurements in inches. Convert from mm by dividing by 25.4.

---

## How to Update Pricing

### Sheet Goods Pricing
1. Find `const MATERIAL_PRICING = {` (around line 1239)
2. Update `pricePerSheet` values for each thickness

### Hardware Pricing
1. Update the `price` field in each hardware item in `HARDWARE_LIBRARY`

### Configurator Purchase Pricing
The configurator sells DXF/BOM outputs as one-time guest purchases (no membership needed).
Every purchase is one file, one transaction. No bundles, no time passes.
- **File price:** $5.00 (set by PIF as Originator)
- **PIF 10% fee:** $0.50 (added to buyer cost per Section 6A)
- **Buyer pays:** $5.50

To update the price:
1. Edit the modal HTML in `configurator.html` (search for `pricingModal`)
2. Update the `$5.50` text in the `.tier-price` div
3. Update the Stripe Price ID in `PIF_PAYMENT.providers.stripe_connect.priceId`

### Platform Membership Pricing (index.html)
The landing page shows the 5-tier membership system for the full marketplace:
- **Design & Go** — Free
- **Emerging** — $9.99/mo
- **Surging** — $49.99/mo
- **Converging** — $149.99/mo
- **Diverging** — $399.99/mo

These prices are defined in `PIF/config/pif-tiers.json`. To update:
1. Edit `PIF/config/pif-tiers.json` with new values
2. Update the `index.html` pricing section HTML to match
3. Update Stripe subscription Price IDs when the platform is built

---

## Payment System — Stripe Connect (Swappable)

The payment system uses a provider abstraction layer designed for easy swap-out.
Current provider: **Stripe Connect**. Fallback: Gumroad.

### How to connect Stripe Connect
1. Create a Stripe account at stripe.com
2. Enable Stripe Connect (for marketplace payment splitting — PIF 10% fee)
3. Create one product in the Stripe dashboard:
   - **Single Config** — $5.50 (one-time, per configuration)
4. In `configurator.html`, find `PIF_PAYMENT.providers.stripe_connect.priceId` and replace the placeholder:
   ```javascript
   priceId: "price_YOUR_REAL_PRICE_ID"
   ```
5. Set the product's success redirect URL to:
   ```
   https://selection-connection.com/configurator.html?paid=1
   ```
6. Test in Stripe test mode before going live

### How the purchase flow works
1. Visitor clicks locked DXF or BOM button → purchase modal appears
2. Visitor clicks Purchase ($5.50)
3. Redirects to Stripe Checkout (guest — no account needed)
4. After payment, Stripe redirects back with `?paid=1` in the URL
5. Page reads the parameter, saves purchase state to `localStorage`, cleans URL
6. DXF and BOM buttons unlock immediately

### How to switch payment providers
The `PIF_PAYMENT` object in `configurator.html` supports multiple providers.
To switch from Stripe to another provider:
1. Add a new provider entry in `PIF_PAYMENT.providers` with `name`, product mapping, and `checkout()` function
2. Change `PIF_PAYMENT.active` to the new provider key
3. The `?paid=PRODUCT_ID` callback mechanism works with any provider

### localStorage keys
- `pif_purchase` — configurator purchase state (`{purchased, date, provider}`)
- To manually unlock for testing:
  ```javascript
  localStorage.setItem("pif_purchase", JSON.stringify({purchased:true,date:new Date().toISOString()}));
  location.reload();
  ```

---

## How to Verify GH Definition Matches Web Computation

1. Open the cabinet configurator
2. Load a preset (e.g., "Kitchen Base")
3. Click "Export JSON" to download the config
4. In Rhino/GH, open the PIF definition
5. Load the exported JSON via the jSwan FilePath input
6. Compare:
   - Part dimensions in GH vs cut list in web UI
   - Door count and sizes
   - Drawer box dimensions
   - Sheet count estimate

Key formula to verify:
- `Interior Width = Width - 2 * SideThickness`
- `Back Height = Height - ToeKickHeight - BottomThickness`
- `Drawer Box Width = Interior Width - 2 * DrawerClearance - 2 * DrawerBoxSideThickness`

---

## Analytics

Events are stored in `localStorage` under the key `pif_analytics`. To view:

1. Open browser DevTools (F12)
2. Console tab
3. Type: `JSON.parse(localStorage.getItem("pif_analytics"))`
4. Or for a summary: `PIF_ANALYTICS.getSummary()`

Tracked events:
- `page_load` — configurator opened
- `preset_load` — chassis preset selected (includes preset name)
- `zone_preset` — zone layout preset selected
- `export` — JSON/PDF/DXF/CSV exported (includes type)
- `pricing_modal_shown` — user clicked a locked button

---

## Zone Stack (Interior Layout)

The zone stack system uses `ZS_` prefix state keys:
- `ZS_LayoutPreset` — index into `ZONE_LAYOUT_PRESETS` array (0-9)
- `ZS_DadoCount` — number of dado shelves (0-3)
- `ZS_Dado1Z/2Z/3Z` — Z position of each dado shelf (inches from interior bottom)
- `ZS_DadoThickness` — dado shelf thickness
- `ZS_Comp1Type` through `ZS_Comp4Type` — compartment types (0=door, 1=drawer, 2=open)

To add a new zone layout preset, find `ZONE_LAYOUT_PRESETS` and add an entry:
```javascript
{ name: "My Layout", dado: 1, dado1Pct: 0.5,
  comps: [
    { type: 0, doors: 2, shelves: 1, drawers: 0 },
    { type: 1, doors: 0, shelves: 0, drawers: 3 }
  ]
}
```

---

## LamiForm Profiles

To add a new LamiForm preset, open `lamiform.html` and find `LAMIFORM_PRESETS`:
```javascript
{
  name: "My Profile",
  type: "tapered",       // tapered, cylindrical, bullnose, ogee, compound
  height: 29,
  topWidth: 1.75,
  bottomWidth: 2.5,
  taperStart: 2,
  curveFactor: 0,
  sliceDir: "horizontal", // horizontal or vertical
  alignment: "threaded_rod" // threaded_rod, dowel_pins, interlocking
}
```

---

## Common Issues

**Cut list shows 0 for all parts:**
Check that `Width`, `Height`, and `Depth` sliders have non-zero values.

**Zone SVG doesn't show:**
The zone SVG only renders when `ZS_DadoCount > 0` or a zone preset with dados is selected.

**PDF export fails:**
Ensure the jsPDF CDN scripts load (requires internet). Check browser console for errors.

**DXF/BOM buttons show lock:**
The purchase state is in `localStorage` key `pif_purchase`. To manually unlock for testing:
```javascript
localStorage.setItem("pif_purchase", JSON.stringify({purchased:true,date:new Date().toISOString()}));
location.reload();
```

**Hardware doesn't auto-fill sliders:**
Hardware selection only works if the selected item has a `params` object. The "Manual / Custom" option intentionally has `params: null`.
