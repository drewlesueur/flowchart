function classifyOrder(order) {
  if (!order.paid) {
    return "hold";
  }

  if (order.total > 1000) {
    approve(order);
  } else {
    review(order);
  }

  for (const item of order.items) {
    if (item.backordered) {
      notifyCustomer(item);
    }
  }

  ship(order);
  return "done";
}
