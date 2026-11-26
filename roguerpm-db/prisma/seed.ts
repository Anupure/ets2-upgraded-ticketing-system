import { PrismaClient, SeatType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const avatarNames = [
    "Road Captain", "Mountain Explorer", "Night Driver", "旅人", "Desert Fox",
    "Retro Racer", "Blue Falcon", "Coastal Traveller", "Snow Runner", "Urban Nomad",
    "Highway Hero", "Pixel Pilot",
  ];

  for (const [index, name] of avatarNames.entries()) {
    await prisma.avatar.upsert({
      where: { name },
      update: { isActive: true, sortOrder: index + 1 },
      create: {
        name,
        imageUrl: `/avatars/passenger-${String(index + 1).padStart(2, "0")}.svg`,
        isActive: true,
        sortOrder: index + 1,
      },
    });
  }

  const seatCoordinates: Array<{ seatNumber: string; rowNumber: number; columnNumber: number }> = [];
  for (let row = 1; row <= 10; row += 1) {
    for (let column = 1; column <= 4; column += 1) {
      seatCoordinates.push({
        seatNumber: `${(row - 1) * 4 + column}`,
        rowNumber: row,
        columnNumber: column,
      });
    }
  }
  seatCoordinates.push(
    { seatNumber: "41", rowNumber: 11, columnNumber: 2 },
    { seatNumber: "42", rowNumber: 11, columnNumber: 3 },
  );

  const layoutJson = {
    version: 1,
    capacity: 42,
    aisleAfterColumn: 2,
    seats: seatCoordinates,
    note: "Illustrative 42-seat layout. Adjust the coordinates to match the actual ETS2 coach interior.",
  };

  const layout = await prisma.busLayout.upsert({
    where: { id: "42a00000-0000-4000-8000-000000000001" },
    update: { capacity: 42, layout: layoutJson, isActive: true },
    create: {
      id: "42a00000-0000-4000-8000-000000000001",
      name: "Standard 42-seat Coach",
      capacity: 42,
      layout: layoutJson,
      isActive: true,
    },
  });

  for (const seat of seatCoordinates) {
    await prisma.busSeat.upsert({
      where: {
        busLayoutId_seatNumber: {
          busLayoutId: layout.id,
          seatNumber: seat.seatNumber,
        },
      },
      update: {
        rowNumber: seat.rowNumber,
        columnNumber: seat.columnNumber,
        seatType: SeatType.STANDARD,
        isBookable: true,
      },
      create: {
        busLayoutId: layout.id,
        seatNumber: seat.seatNumber,
        rowNumber: seat.rowNumber,
        columnNumber: seat.columnNumber,
        seatType: SeatType.STANDARD,
        isBookable: true,
      },
    });
  }

  console.log(`Seeded ${avatarNames.length} avatars and ${seatCoordinates.length} seats.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
