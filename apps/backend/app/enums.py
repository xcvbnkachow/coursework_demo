from enum import Enum


class UserMode(str, Enum):
    worker = "worker"
    employer = "employer"


class OrderStatus(str, Enum):
    published = "published"
    responded = "responded"
    assigned = "assigned"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"
    disputed = "disputed"


class ResponseStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"
    withdrawn = "withdrawn"


class TransactionType(str, Enum):
    top_up = "top_up"
    escrow_hold = "escrow_hold"
    employer_commission = "employer_commission"
    worker_payout = "worker_payout"
    worker_commission = "worker_commission"
    refund = "refund"


class TransactionStatus(str, Enum):
    pending = "pending"
    completed = "completed"
    failed = "failed"

