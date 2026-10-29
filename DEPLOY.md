# 🚀 Deployment Guide: E-Commerce Sales & Customer Analytics System

This project is a full-stack **Node.js + Express + MySQL** application with a responsive web dashboard. It is completely cloud-ready with:
- ✅ Automatic database schema creation on boot (zero manual database migrations needed)
- ✅ Support for both unified connection URLs (`DATABASE_URL` / `MYSQL_URL`) and separate DB variables (`DB_HOST`, `DB_PORT`, etc.)
- ✅ Automatic SSL handling for cloud MySQL providers (Railway, TiDB Cloud, Aiven, PlanetScale)
- ✅ Static frontend serving from Express (`public/index.html`) using relative API endpoints

---

## 🌟 Option 1: Deploy on Railway (Recommended — Fastest & Easiest)

Railway allows you to deploy both your **Node.js Web Service** and a **MySQL Database** inside the same project with zero hassle.

### Step 1: Push your code to GitHub
If you haven't pushed the latest changes:
```bash
git add .
git commit -m "Configure auto-migrations and cloud deployment support"
git push origin main
```

### Step 2: Create Project on Railway
1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. Click **"New Project"** → **"Deploy from GitHub repo"**.
3. Select your repository: `prabhunarasapur5-collab/E-Commerce-Analytics`.

### Step 3: Add a MySQL Database
1. In your Railway project canvas, click **"+ New"** → **"Database"** → **"Add MySQL"**.
2. Railway will spin up a MySQL service in seconds.

### Step 4: Connect Web Service to MySQL
1. Click on your **Node.js Web Service** card.
2. Go to the **"Variables"** tab.
3. Click **"Add Reference"** or add:
   - `DATABASE_URL` = `${{MySQL.DATABASE_URL}}` (or `${{MySQL.MYSQL_URL}}`)
   - `JWT_SECRET` = `ecom_production_secret_key_2026`
   - `NODE_ENV` = `production`
4. That's it! The backend automatically reads `DATABASE_URL`, connects with SSL, creates the tables (`users`, `datasets`, `dataset_rows`), and sets up the default admin account.

### Step 5: Generate Public Domain
1. In the Web Service card, go to **"Settings"** → **"Networking"**.
2. Click **"Generate Domain"** (e.g. `https://ecommerce-analytics-production.up.railway.app`).
3. Click your new public link — your app is live!

---

## 🌐 Option 2: Deploy on Render + TiDB Cloud (100% Free Tier)

If you want a 100% free hosting setup:

### Step 1: Create a Free MySQL Database on TiDB Cloud
1. Go to [tidbcloud.com](https://tidbcloud.com) and create a free Serverless tier cluster.
2. Click **"Connect"** → select **Node.js (mysql2)**.
3. Copy the connection string or credentials (host, port, user, password, database).

### Step 2: Deploy Web Service on Render
1. Go to [render.com](https://render.com) and sign in with GitHub.
2. Click **"New +"** → **"Web Service"**.
3. Select your repository `E-Commerce-Analytics`.
4. Configure:
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Under **Environment Variables**, add:
   - `DATABASE_URL` = *(Your TiDB Cloud connection string)*
   - `DB_SSL` = `true`
   - `JWT_SECRET` = `render_production_secret_jwt_2026`
6. Click **"Create Web Service"**. Render will deploy your site and provide a free `https://your-app.onrender.com` URL.

---

## 🔑 Default Credentials on Fresh Deployment
When deployed to a clean database, the system automatically provisions an initial admin account:
- **Email:** `admin@ecomanalytics.io`
- **Password:** `Admin@123`

You can also create any new account directly using the **"Create Account"** tab on the login screen.
