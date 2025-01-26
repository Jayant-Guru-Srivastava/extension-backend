const { PrismaClient } = require("@prisma/client");
const { faker } = require('@faker-js/faker');

const prisma = new PrismaClient();

async function seedDatabase() {
    try {
        // Create Users
        const users = [];
        for (let i = 0; i < 100; i++) { // Create 3 dummy users
            const user = await prisma.user.create({
                data: {
                    name: faker.person.fullName(),
                    email: faker.internet.email(),
                    password: faker.internet.password(),
                    isPremium: faker.datatype.boolean(),
                    paymentTotal: faker.number.float({ min: 0, max: 1000, precision: 2 }),
                    paymentRemaining: faker.number.float({ min: 0, max: 1000, precision: 2 }),
                },
            });
            users.push(user);
        }


         // Create Conversations
       for (const user of users) {
           const numConversations = faker.number.int({ min: 1, max: 3 }); // 1-3 conversations
           for (let j = 0; j < numConversations; j++) {
               const conversation = await prisma.conversation.create({
                   data: {
                       userId: user.id,
                       repositoryName: 'dub.sh',
                       iteration: 1,
                     }
               });

             // Create Messages for each conversation
              const numMessages = faker.number.int({ min: 100, max: 1500 }); // 5-15 messages

             for (let k = 0; k < numMessages; k++){
                   await prisma.message.create({
                      data: {
                        conversationId: conversation.id,
                        role: faker.helpers.arrayElement(['user', 'assistant']),
                        content: faker.lorem.paragraph(),
                         sequence: k+1
                      }
                   });
              }
            }
         }


        console.log("Database seeded successfully!");
    } catch (error) {
        console.error("Error seeding database:", error);
    } finally {
        await prisma.$disconnect();
    }
}

seedDatabase();