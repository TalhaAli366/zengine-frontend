# TikTok Influencer Marketing Platform - Frontend

A modern, professional authentication system and dashboard for the TikTok Influencer Marketing Automation Platform built with Next.js 14, TypeScript, Tailwind CSS, and Supabase.
 
## Features  
 
- ✅ **Modern Authentication System** 
  - Login with email/password 
  - Sign up with email verification 
  - Forgot password / Password reset 
  - Protected routes with middleware  
  - Session management with Supabase Auth   
 
- ✅ **Professional UI/UX** 
  - Beautiful gradient branding section 
  - Responsive design (mobile-first)
  - Loading states and error handling   
  - Toast notifications
  - Modern glassmorphism effects

- ✅ **Dashboard Layout**
  - Sidebar navigation
  - User profile section
  - Protected routes
  - Quick action cards
  - Analytics widgets

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Authentication**: Supabase Auth
- **Icons**: Lucide React
- **Database**: Supabase (PostgreSQL)

## Prerequisites

Before running this project, make sure you have:

1. Node.js 18+ installed
2. A Supabase account and project
3. npm or yarn package manager

## Setup Instructions

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the `frontend` directory:

```bash
cp .env.local.example .env.local
```

Then edit `.env.local` and add your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**To get your Supabase credentials:**
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to Settings → API
4. Copy the Project URL and anon/public key

### 3. Run the Database Schema

Before running the app, execute the database schema:

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy the contents of `../supabase_phase1_schema.sql`
4. Paste and run it in the SQL editor

### 4. Configure Supabase Auth

In your Supabase dashboard:

1. Go to Authentication → URL Configuration
2. Add your site URL (e.g., `http://localhost:3000` for development)
3. Add redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3000/auth/reset-password`

4. Go to Authentication → Providers
5. Ensure Email provider is enabled

### 5. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
frontend/
├── app/
│   ├── auth/
│   │   ├── login/page.tsx          # Login page
│   │   ├── signup/page.tsx         # Sign up page
│   │   └── forgot-password/page.tsx # Password reset
│   ├── dashboard/
│   │   ├── layout.tsx              # Dashboard layout with sidebar
│   │   └── page.tsx                # Dashboard home
│   ├── globals.css                 # Global styles
│   ├── layout.tsx                  # Root layout
│   └── page.tsx                    # Landing page (redirects to login)
├── lib/
│   └── supabase/
│       ├── client.ts               # Client-side Supabase client
│       └── server.ts               # Server-side Supabase client
├── middleware.ts                   # Auth middleware for route protection
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.js
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Authentication Flow

1. **Sign Up**: New users create an account with email/password
2. **Email Verification**: Supabase sends verification email
3. **Login**: Users sign in with verified credentials
4. **Protected Routes**: Middleware checks auth status
5. **Dashboard Access**: Authenticated users access dashboard
6. **Sign Out**: Users can log out from dashboard

## Route Protection

The middleware automatically:
- Redirects unauthenticated users to `/auth/login` when accessing `/dashboard/*`
- Redirects authenticated users to `/dashboard` when accessing `/auth/*`

## Customization

### Colors

Edit `tailwind.config.ts` to customize the primary color palette:

```typescript
colors: {
  primary: {
    50: '#f0f9ff',
    // ... customize colors
  },
}
```

### Branding

Edit the branding section in login/signup pages:
- Update the logo/icon
- Modify the feature cards
- Change gradient colors

## Next Steps

1. ✅ **Module 1 Complete**: Database & Authentication
2. ⏳ **Module 2**: TikTok Hashtag Scraper
3. ⏳ **Module 3**: TikTok Sound ID Scraper
4. ⏳ **Module 4**: Data Enrichment & Metrics
5. ⏳ **Module 5**: Central Dashboard (expand)
6. ⏳ **Module 6**: Outreach Automation

## Troubleshooting

### "Invalid API key" error
- Verify your `.env.local` has correct Supabase credentials
- Restart the dev server after changing env variables

### Email not sending
- Check Supabase Authentication settings
- Verify email templates are configured
- Check spam folder

### Route protection not working
- Clear browser cookies/cache
- Check middleware configuration
- Verify Supabase session is active

## Support

For issues or questions:
- Check [Next.js Documentation](https://nextjs.org/docs)
- Check [Supabase Documentation](https://supabase.com/docs)
- Review [Tailwind CSS Documentation](https://tailwindcss.com/docs)

---

**Built by Eynvision** | © 2025 All rights reserved

