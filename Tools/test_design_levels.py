#!/usr/bin/env python3
"""关卡搜索的区域唯一性回归测试。"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from prototype_eval import (
    Board,
    Rules,
    can_place_district,
    enumerate_layouts,
    effective,
    frontier,
    greedy,
)

CAMPUS = "DISTRICT_CAMPUS"
GOV = "DISTRICT_GOVERNMENT"


def board_with_empty_slots(count=3):
    tiles = {(0, 0): {"地形": "TERRAIN_GRASS", "区域": "DISTRICT_CITY_CENTER"}}
    for q in range(1, count + 1):
        tiles[(q, 0)] = {"地形": "TERRAIN_GRASS", "区域": None}
    return Board(tiles)


class DistrictUniquenessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rules = Rules()

    def test_repeating_one_per_city_district_is_not_enumerated(self):
        layouts = enumerate_layouts(
            self.rules, board_with_empty_slots(), [CAMPUS], 2, ["科技"],
        )
        self.assertFalse(any(len(plan) == 2 for plan, _ in layouts))

    def test_two_government_plazas_are_not_enumerated(self):
        layouts = enumerate_layouts(
            self.rules, board_with_empty_slots(), [GOV], 2, ["科技"],
        )
        self.assertFalse(any(len(plan) == 2 for plan, _ in layouts))

    def test_two_campuses_in_korea_count_as_two_seowons(self):
        layouts = enumerate_layouts(
            self.rules, board_with_empty_slots(), [CAMPUS], 2, ["科技"],
            civ="CIVILIZATION_KOREA",
        )
        self.assertFalse(any(len(plan) == 2 for plan, _ in layouts))
        self.assertEqual(
            effective(self.rules, CAMPUS, "CIVILIZATION_KOREA"),
            "DISTRICT_SEOWON",
        )

    def test_unlimited_district_can_repeat(self):
        layouts = enumerate_layouts(
            self.rules, board_with_empty_slots(), ["DISTRICT_CANAL"], 2, ["科技"],
        )
        self.assertTrue(any(len(plan) == 2 for plan, _ in layouts))

    def test_search_and_product_effective_id_use_the_same_limit_rule(self):
        board = board_with_empty_slots()
        self.assertTrue(can_place_district(
            self.rules, board, CAMPUS, "CIVILIZATION_KOREA",
        ))
        board = board.copy_with((1, 0), "DISTRICT_SEOWON")
        self.assertFalse(can_place_district(
            self.rules, board, CAMPUS, "CIVILIZATION_KOREA",
        ))

    def test_frontier_does_not_return_a_duplicate_one_per_city_plan(self):
        result = frontier(self.rules, board_with_empty_slots(), [CAMPUS], 2)
        self.assertIsNone(result[2][1])

    def test_greedy_does_not_extend_with_an_illegal_duplicate(self):
        _, steps = greedy(
            self.rules, board_with_empty_slots(), [CAMPUS], 2, "科技",
        )
        self.assertLessEqual(len(steps), 1)


if __name__ == "__main__":
    unittest.main()
