export interface BenchmarkQuestion {
    position: {x: number | null, y: number | null};
    hotspot: string | null;
    question: string;
}

export const islet2_genericQuestions: BenchmarkQuestion[] = [
    {
        position: {x: 12, y: 12},
        hotspot: null,
        question: "Describe the drawing very quickly."
    },
    {
        position: {x: 400, y: 400},
        hotspot: "Lawn",
        question: "Camio start."
    },
    {
        position: {x: 300, y: 100},
        hotspot: "Rainbow",
        question: "Camio stop."
    },
    {
        position: {x: 100, y: 12},
        hotspot: null,
        question: "Hello."
    },
];

export const islet2_positionQuestions: BenchmarkQuestion[] = [
    {
        position: {x: null, y: null},
        hotspot: null,
        question: ""
    }
];

export const hwr2_genericQuestions: BenchmarkQuestion[] = [
    {
        position: {x: null, y: null},
        hotspot: null,
        question: ""
    }
];

export const hwr2_positionQuestions: BenchmarkQuestion[] = [
    {
        position: {x: null, y: null},
        hotspot: null,
        question: ""
    }
];