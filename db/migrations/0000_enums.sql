CREATE TYPE "public"."break_type" AS ENUM('lunch', 'prayer', 'personal', 'meeting', 'internet_issue', 'power_issue', 'emergency', 'other');--> statement-breakpoint
CREATE TYPE "public"."daily_task_status" AS ENUM('planned', 'in_progress', 'done', 'partially_done', 'pending', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."half_selection" AS ENUM('first_half', 'second_half');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('sick', 'casual', 'emergency', 'half_day', 'wfh', 'late_arrival', 'early_leave', 'overtime');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."proof_type" AS ENUM('url', 'google_doc', 'google_sheet', 'screenshot', 'file', 'loom', 'staging_url', 'published_url', 'report', 'other');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('approved', 'revision_requested');--> statement-breakpoint
CREATE TYPE "public"."signout_type" AS ENUM('normal', 'early', 'auto_closed', 'half_day');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('planned', 'in_progress', 'blocked', 'submitted', 'revision_required', 'approved', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'team_leader', 'project_manager', 'admin_hr', 'employee');--> statement-breakpoint
CREATE TYPE "public"."work_type" AS ENUM('in_office', 'remote', 'client_site');