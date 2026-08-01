CREATE TABLE `attendance_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`station_id` text NOT NULL,
	`staff_id` integer NOT NULL,
	`shift_id` integer NOT NULL,
	`log_date` text NOT NULL,
	`scanned_at` integer NOT NULL,
	`status` text NOT NULL,
	`source` text DEFAULT 'qr' NOT NULL,
	`note` text,
	FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_unique` ON `attendance_log` (`staff_id`,`shift_id`,`log_date`);--> statement-breakpoint
CREATE INDEX `attendance_station_date_idx` ON `attendance_log` (`station_id`,`log_date`);--> statement-breakpoint
CREATE INDEX `attendance_staff_date_idx` ON `attendance_log` (`staff_id`,`log_date`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`start_time` text NOT NULL,
	`qr_starts_min` integer DEFAULT 45 NOT NULL,
	`qr_ends_min` integer DEFAULT 30 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`station_id` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `staff_station_idx` ON `staff` (`station_id`);--> statement-breakpoint
CREATE TABLE `stations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`secret` text NOT NULL,
	`last_heartbeat_at` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
