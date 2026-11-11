import subprocess
import unittest
from unittest.mock import Mock, patch

from run_backend import supervise_worker


class WorkerSupervisorTests(unittest.TestCase):
    def test_exited_worker_restarts_and_leaves_job_recovery_to_worker(self):
        first, second = Mock(), Mock()
        first.wait.return_value = 1
        first.poll.return_value = 1
        second.wait.return_value = 0
        second.poll.return_value = 0
        stopped = Mock()
        stopped.is_set.return_value = False
        stopped.wait.side_effect = [False, True]
        with patch("run_backend.subprocess.Popen", side_effect=[first, second]) as spawn:
            supervise_worker("test-data", stopped)
        self.assertEqual(spawn.call_count, 2)
        self.assertEqual(spawn.call_args.args[0][-2:], ["--data-dir", "test-data"])
        self.assertIn("utf8", spawn.call_args.args[0])
        first.terminate.assert_not_called()
        second.terminate.assert_not_called()

    def test_launch_failure_waits_before_retry(self):
        stopped = Mock()
        stopped.is_set.return_value = False
        stopped.wait.return_value = True
        with patch("run_backend.subprocess.Popen", side_effect=OSError("unavailable")) as spawn:
            supervise_worker("test-data", stopped)
        spawn.assert_called_once()
        stopped.wait.assert_called_once_with(3)

    def test_shutdown_stops_current_child_and_does_not_restart(self):
        stopped = Mock()
        stopped.is_set.side_effect = [False, False, True]
        stopped.wait.return_value = True
        child = Mock()
        child.poll.return_value = None
        child.wait.side_effect = [subprocess.TimeoutExpired("worker", 2), subprocess.TimeoutExpired("worker", 5), 0]
        with patch("run_backend.subprocess.Popen", return_value=child) as spawn:
            supervise_worker("test-data", stopped)
        spawn.assert_called_once()
        child.terminate.assert_called_once()
        child.kill.assert_called_once()


if __name__ == "__main__":
    unittest.main()
