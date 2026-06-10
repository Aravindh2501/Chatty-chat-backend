export const getRoomName = (userId1, userId2) => {
  const sorted = [userId1.toString(), userId2.toString()].sort();
  return `room_${sorted[0]}_${sorted[1]}`;
};
