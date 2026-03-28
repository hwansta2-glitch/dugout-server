-- CreateTable
CREATE TABLE "GameResult" (
    "id" SERIAL NOT NULL,
    "gameDate" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayScore" INTEGER,
    "homeScore" INTEGER,
    "stadium" TEXT,
    "startTime" TEXT,
    "awayPitcher" TEXT,
    "homePitcher" TEXT,
    "winPitcher" TEXT,
    "losePitcher" TEXT,
    "savePitcher" TEXT,
    "innings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameResult_gameId_key" ON "GameResult"("gameId");
