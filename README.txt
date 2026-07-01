MR. GOLISODA TRAINING PORTAL (LMS)
South Asian Food Corporation
====================================

WHAT THIS IS
A Flask + SQLite Learning Management System with admin dashboard,
assessment engine, content modules, certificates, and full branding.

FOLDER STRUCTURE (matches GitHub repo)
  app.py                       -> main application (root)
  requirements.txt             -> Python packages
  .python-version              -> Python 3.11.9
  render.yaml                  -> Render deploy config
  templates/
      admin.html               -> admin dashboard
      portal.html              -> learner portal
      assessment.html          -> assessment take-page
      login.html               -> (ON YOUR GITHUB - not in this zip)
  static/
      css/styles.css           -> (ON YOUR GITHUB - not in this zip)
      js/
          admin.js
          assess-admin.js
          content-admin.js
          portal.js
          content.js
          assessment.js
          brand_assets.js      -> all brand images (logo, mascot, signatures)

IMPORTANT - TWO FILES NOT IN THIS ZIP
  login.html  and  styles.css
These live only on your GitHub (github.com/mrgolisoda01/Golisoda-LMS).
They were never re-sent during this build, so download them from GitHub
if you need a complete offline copy.

DEFAULT ADMIN LOGIN
  Employee ID: ADMIN
  Password:    Golisoda@2026   (change after first login via Settings)

TECH
  Python 3.11 / Flask / SQLite / deployed on Render
  Database file: golisoda.db (created automatically on first run)

NOTE ON DATA PERMANENCE
  On Render's FREE plan the database resets on restart.
  Upgrade to Starter ($7/mo) + add a Persistent Disk, and point the
  database path to the disk, to keep data permanent.
