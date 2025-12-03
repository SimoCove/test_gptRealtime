type PositionSendingMethod =
    | null
    | "normCoord"
    | "normCoordAndHotspot"
    | "coord"
    | "coordAndHotspot"
    | "imgWithPos"
    | "imgWithPosAndHotspot";

import {
    BenchmarkQuestion,
    islet2_genericQuestions,
    islet2_positionQuestions,
    hwr2_genericQuestions,
    hwr2_positionQuestions
} from "./testModeQuestions/benchmarkQuestions";

export const POSITION_SENDING_METHOD: PositionSendingMethod = "imgWithPosAndHotspot"; // you can change the position sending method here
export const CAMIO_FILE_NAME: string = "Islet2"; // you can change the camio file here
// Aeroplano
// Airplane
// Automobile
// Car
// House_with_rainbow
// House_with_rainbow2
// Islet
// Islet2

export const TEST_MODE: boolean = false; // you can enable/disable the test mode here
export const BENCHMARK_QUESTIONS: BenchmarkQuestion[] = islet2_positionQuestions; // you can change the benchmark questions for test mode here