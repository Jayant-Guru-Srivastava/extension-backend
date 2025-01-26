/*
  Warnings:

  - A unique constraint covering the columns `[userId,repositoryName,iteration]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[conversationId,sequence]` on the table `Message` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Conversation_userId_repositoryName_iteration_key" ON "Conversation"("userId", "repositoryName", "iteration");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_sequence_key" ON "Message"("conversationId", "sequence");
