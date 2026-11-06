import unittest

from server.rife_parallel import (
    BANDWIDTH_LIMIT_PIXELS,
    expected_frame_count,
    estimate_worker_count,
    io_workers_from_env,
    output_index_for_pair,
    passes_for_target,
    split_pairs,
    workers_from_env,
)


class PassesForTargetTests(unittest.TestCase):
    def test_doubles_until_the_next_step_would_overshoot(self):
        self.assertEqual(passes_for_target(30, 60), 1)
        self.assertEqual(passes_for_target(30, 120), 2)
        self.assertEqual(passes_for_target(24, 60), 1)  # 48fps 就停，不会再翻到 96
        self.assertEqual(passes_for_target(60, 60), 0)
        self.assertEqual(passes_for_target(60, 30), 0)


class SplitPairsTests(unittest.TestCase):
    def test_every_pair_belongs_to_exactly_one_worker(self):
        for total in (1, 2, 5, 119, 180):
            for workers in (1, 2, 3, 4, 6):
                ranges = split_pairs(total, workers)
                covered = [i for start, stop in ranges for i in range(start, stop)]
                self.assertEqual(covered, list(range(total)), f"total={total} workers={workers}")
                self.assertLessEqual(len(ranges), max(1, min(workers, total)))

    def test_ranges_are_balanced(self):
        ranges = split_pairs(10, 3)
        self.assertEqual(ranges, [(0, 4), (4, 7), (7, 10)])

    def test_never_spawns_more_workers_than_pairs(self):
        self.assertEqual(len(split_pairs(2, 6)), 2)
        self.assertEqual(split_pairs(0, 4), [])


class OutputNumberingTests(unittest.TestCase):
    def test_pair_k_writes_mid_then_original(self):
        self.assertEqual(output_index_for_pair(0), (2, 3))
        self.assertEqual(output_index_for_pair(7), (16, 17))

    def test_numbering_has_no_gaps_and_no_duplicates(self):
        pairs = 60
        indices = {1}
        for k in range(pairs):
            mid, nxt = output_index_for_pair(k)
            indices.add(mid)
            indices.add(nxt)
        self.assertEqual(sorted(indices), list(range(1, expected_frame_count(pairs + 1) + 1)))

    def test_expected_frame_count(self):
        self.assertEqual(expected_frame_count(120), 239)
        self.assertEqual(expected_frame_count(2), 3)
        self.assertEqual(expected_frame_count(1), 1)


class WorkerCountTests(unittest.TestCase):
    PIXELS_720P = 1280 * 720

    def test_uses_the_requested_count_when_vram_allows(self):
        self.assertEqual(estimate_worker_count(7 * 1024 ** 3, self.PIXELS_720P, 4), 4)
        self.assertEqual(estimate_worker_count(7 * 1024 ** 3, self.PIXELS_720P, 6), 6)

    def test_never_exceeds_the_cap(self):
        self.assertEqual(estimate_worker_count(64 * 1024 ** 3, self.PIXELS_720P, 12), 6)

    def test_shrinks_when_vram_is_tight(self):
        # 8GB 卡上被别人占掉一半，只剩 512MB 就别硬开 4 路
        self.assertEqual(estimate_worker_count(512 * 1024 ** 2, self.PIXELS_720P, 4), 1)

    def test_high_resolution_is_capped_by_bandwidth(self):
        pixels_1080p = 1920 * 1080
        self.assertGreaterEqual(pixels_1080p, BANDWIDTH_LIMIT_PIXELS)
        # 1080P 实测 3 路反而掉到 386ms/对，所以最多 2 路
        self.assertEqual(estimate_worker_count(16 * 1024 ** 3, pixels_1080p, 6), 2)

    def test_without_vram_info_falls_back_to_one(self):
        self.assertEqual(estimate_worker_count(None, self.PIXELS_720P, 4), 1)


class EnvTests(unittest.TestCase):
    def test_worker_env_defaults_and_clamp(self):
        self.assertEqual(workers_from_env({}), 4)
        self.assertEqual(workers_from_env({"RIFE_WORKERS": "6"}), 6)
        self.assertEqual(workers_from_env({"RIFE_WORKERS": "9"}), 6)
        self.assertEqual(workers_from_env({"RIFE_WORKERS": "0"}), 1)
        self.assertEqual(workers_from_env({"RIFE_WORKERS": "oops"}), 4)

    def test_io_env_defaults_and_clamp(self):
        self.assertEqual(io_workers_from_env({}), 6)
        self.assertEqual(io_workers_from_env({"RIFE_IO_WORKERS": "2"}), 2)
        self.assertEqual(io_workers_from_env({"RIFE_IO_WORKERS": "-3"}), 1)


if __name__ == "__main__":
    unittest.main()
