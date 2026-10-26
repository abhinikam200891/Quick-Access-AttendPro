# Quick Access AttendPro - Enterprise QR Code Attendance System

An enterprise-grade, mobile-friendly web application for attendance tracking built with **HTML5, Vanilla CSS, JavaScript (ES Modules)**, and **Supabase (PostgreSQL with Row Level Security & Atomic Stored Procedures)**.

---

## 🎯 Architecture Overview

- **Admin Portal (Laptop / Desktop)**:
  - Event creation with customized check-in windows, venue coordinates, and permitted roles (Staff, Agent, Both).
  - Geofence radius control (e.g., 50 meters) with one-click current GPS auto-detection.
  - Assign staff as attendance takers; each gets a private beacon link (`host.html?...&key=...`) that shows a rotating QR signed with their own key. There is no static venue QR: attendees can only check in by scanning a live staff QR.
  - Live attendance with Present / Pending views, manual "Mark Present" with a reason (audited), late flag and optional check-out.
  - Event activation, deactivation, and expiration controls.
  - Live filterable attendance table (by Event, Role, Division, Branch, Date, Search).
  - One-click attendance report export to CSV/Excel.
  - Staff & Agent Master Directory with activation toggle.
  - Security audit log monitoring for tamper/rejection forensics.

- **User Portal (Mobile Smartphone Browser)**:
  - Direct QR scanner / mobile camera redirect (zero native app installation needed).
  - Event confirmation card (Venue, Date, Check-in Window, Permitted Roles).
  - Role switcher: **Staff** or **Agent**.
  - Dynamic cascading Division &rarr; Branch dropdowns.
  - 2-factor credential validation: Employee/Agent Code + Registered Mobile Number.
  - GPS Geofence verification using the **Haversine Formula** (both client radar and server-side calculation).
  - Atomic single-submission check to eliminate duplicate records.
  - Official digital attendance pass receipt with verified timestamp, distance, and unique ticket barcode reference.

---

## 🛡️ Security & Row Level Security (RLS) Design

1. **Least-Privilege RLS Policies**:
   - `members`: Public anonymous users have **NO SELECT, NO INSERT, NO UPDATE** access. The check-in dropdowns use the `list_branch_members` RPC, which returns only id, name and code (never phone numbers).
   - Admin rights come from the `admins` table (`is_admin()`), not from simply being signed in.
   - `events`: Only active events are accessible to public users.
   - `attendance`: Anonymous users cannot directly insert or select from the attendance table. Attendance records can only be created via the atomic `submit_attendance` stored procedure.
2. **Atomic Verification Stored Procedure (`SECURITY DEFINER`)**:
   - Executes inside PostgreSQL to perform atomic checks:
     - Event active status and QR security token match.
     - Event date and time window validity.
     - Role eligibility.
     - Member active status and credential matching (Code + Mobile + Division + Branch).
     - Geofence distance computation ($d \le \text{radius}$).
     - Duplicate attendance prevention.
3. **Audit Logging**:
   - All check-in attempts (successful, rejected, or flagged) are logged to `audit_logs` with reason, timestamp, and client user-agent.

---

## 🚀 Quick Start (Local Development)

### 1. Install & Run Dev Server
```bash
npm install
npm run dev
```

The Vite dev server will start at:
- Local: `http://localhost:5173/`
- Network (for phone testing): `http://<your-lan-ip>:5173/`

### 2. Ready-to-Test Demo Data
The application includes a built-in mock and fallback engine with pre-seeded data so you can test all features immediately without configuring a database first:

| Role | Name | Code | Registered Mobile | Division | Branch | Status |
|---|---|---|---|---|---|---|
| **Staff** | Alexander Wright | `STF-1001` | `9876543210` | Corporate Division | Global Headquarters - Tower A | Active |
| **Staff** | Sophia Chen | `STF-1002` | `9812345678` | Corporate Division | Tech Innovation Campus | Active |
| **Agent** | Priya Sharma | `AGT-2001` | `9899887766` | Agency & Field Distribution | North Zone Agency Network | Active |
| **Agent** | David Kim | `AGT-2002` | `9788776655` | Agency & Field Distribution | South Zone Regional Agency | Active |
| **Staff** | Marcus Vance | `STF-9999` | `9655443322` | Retail & Consumer Banking | Metro Plaza Premium Branch | **Inactive (Blocked)** |

---

## 🗄️ Supabase Deployment Instructions

1. Create a new project in [Supabase](https://supabase.com/).
2. Open the **SQL Editor** in your Supabase dashboard.
3. Copy the contents of [`supabase/schema.sql`](file:///c:/Users/dell/OneDrive/Desktop/attendance/supabase/schema.sql) and click **Run**.
   `schema.sql` is safe to re-run on an existing project: it drops and recreates its policies and replaces its functions.
4. (Optional) Run [`supabase/seed.sql`](file:///c:/Users/dell/OneDrive/Desktop/attendance/supabase/seed.sql) to populate initial sample records.
5. Create admin accounts. Self-registration is disabled in live mode, and signing in alone grants nothing:
   - In **Authentication → Users**, add the admin user (or invite them).
   - In the SQL Editor, grant admin rights:
     ```sql
     INSERT INTO admins (user_id) SELECT id FROM auth.users WHERE email = 'you@example.com';
     ```
   - In **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**.
6. Serve the site over **HTTPS**. Host phones sign the rotating QR with Web Crypto, which browsers only allow on HTTPS (or localhost).
7. Send each attendance taker their own beacon link from **Assign Staff → Copy Link**. The first phone that opens it is locked to that beacon; reset it from the same screen if they change phones. Opening the link yourself locks it to your device.
8. Events store a `timezone` (defaults to the admin browser's zone, else `Asia/Kolkata`). Check-in windows are evaluated in that zone.
9. In the Admin Portal, click **⚙️ Settings & Supabase**:
   - Set **Data Engine Mode** to `Live Supabase Cloud Database`.
   - Enter your **Project URL** and **Anon Key** (found in Supabase *Project Settings &rarr; API*).
   - Click **Test Connection** &rarr; **Save Settings**.
