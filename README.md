# Noodles Checkpoint Audit

A small mobile-friendly web app for checkpoint audits.

## What it does

- Opens with your workbook checklist already loaded
- Loads a checklist from CSV or pasted Excel rows
- Uses large tap buttons for each line item score
- Gives every line item its own notes box
- Autosaves progress in the browser
- Exports completed audits to CSV
- Supports install-to-home-screen behavior when hosted over HTTPS or `localhost`

## Checklist format

Use these headers if you want the cleanest import:

```csv
section,item,points,details,notes placeholder
Kitchen,Hot holding temperatures are in range,5,Check the line and note any temperature misses.,Record the pan temp and fix.
```

Notes:

- `section` groups items together
- `item` is the line item text
- `points` lets the app build buttons from full credit down to zero plus `N/A`
- `options` is still supported if you want custom non-score choices instead
- `details` is optional helper text shown under the item
- `notes placeholder` is optional helper text inside the notes box

## How to use it

1. Open `index.html` in a browser to test locally on your computer.
2. Use the built-in checklist from `CheckPoints Version 4.xlsx`, or replace it by importing `checklist-template.csv`, your own CSV, or pasted rows copied from Excel.
3. Fill out the audit and use `Export Audit` when finished.

## Using it on your phone

For phone use, host this folder on any static site service or run a local server on your computer and open it from your phone browser on the same network.

### GitHub Pages

This app is ready for GitHub Pages because it is just static files.

1. Create a new GitHub repository.
2. Upload everything in this folder.
3. In GitHub, open `Settings` -> `Pages`.
4. Under `Build and deployment`, choose `Deploy from a branch`.
5. Select your main branch and the `/ (root)` folder, then save.
6. Wait for GitHub to publish the site and open the Pages URL on your phone.

After that, you can add the site to your home screen from your phone browser.

Example local server:

```powershell
python -m http.server 8000
```
