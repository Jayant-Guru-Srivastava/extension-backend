/*
  Warnings:

  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentRemaining" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "paymentTotal" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "TokenUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "outputTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "inputTokenCost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "outputTokenCost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,

    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repositoryName" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
