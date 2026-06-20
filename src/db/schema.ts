import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp, doublePrecision, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  name: text('name').notNull().default('New User'),
  role: text('role').notNull().default('cargo_agent'),
  hubType: text('hub_type').notNull().default('Cargo Station'),
  hub: text('hub').notNull().default('Lagos'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const transactions = pgTable('transactions', {
  id: text('id').primaryKey(), // using the generated ID like 'CG-...'
  userId: integer('user_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  detail: text('detail').notNull(),
  amount: doublePrecision('amount').notNull(),
  mode: text('mode').notNull(),
  time: text('time').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  bank: text('bank'),
  awb_tag_number: text('awb_tag_number'),
  consignee: text('consignee'),
  pieces: integer('pieces'),
  kg: doublePrecision('kg'),
  contentType: text('content_type'),
  remarks: text('remarks'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const expenses = pgTable('expenses', {
  id: text('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  type: text('type').notNull(),
  amount: doublePrecision('amount').notNull(),
  description: text('description'),
  time: text('time').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  transactions: many(transactions),
  expenses: many(expenses),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  user: one(users, { fields: [expenses.userId], references: [users.id] }),
}));
