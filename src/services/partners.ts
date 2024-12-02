import { supabase } from '../lib/supabase';

export async function searchUsers(query: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  
  const { data, error } = await supabase
    .from('users')
    .select('id, name, username')
    .or(`username.ilike.%${query}%,name.ilike.%${query}%,email.ilike.%${query}%`)
    .neq('id', user.id)
    .not('id', 'in', (
      supabase
        .from('workout_partners')
        .select('partner_id')
        .eq('user_id', user.id)
        .or(`status.eq.pending,status.eq.accepted`)
    ))
    .limit(10);

  if (error) {
    console.error('Search error:', error);
    throw new Error('Failed to search users');
  }
  
  return data || [];
}

export async function sendPartnerInvite(partnerId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('workout_partners')
    .insert({
      user_id: user.id,
      partner_id: partnerId,
      status: 'pending'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getPartners() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Get sent invites
  const { data: sentInvites, error: sentError } = await supabase
    .from('workout_partners')
    .select(`
      id,
      status,
      created_at,
      is_favorite,
      partner:users!workout_partners_partner_id_fkey (
        id, 
        name,
        username
      )
    `)
    .eq('user_id', user.id);
  
  if (sentError) {
    console.error('Error fetching sent invites:', sentError);
    return { sent: [], received: [] };
  }

  // Get received invites
  const { data: receivedInvites, error: receivedError } = await supabase
    .from('workout_partners')
    .select(`
      id,
      status,
      created_at,
      is_favorite,
      user:users!workout_partners_user_id_fkey (
        id,
        name,
        username
      )
    `)
    .eq('partner_id', user.id);

  if (receivedError) {
    console.error('Error fetching received invites:', receivedError);
    return { sent: [], received: [] };
  }

  return {
    sent: sentInvites || [],
    received: receivedInvites || []
  };
}

export async function respondToInvite(inviteId: string, status: 'accepted' | 'rejected') {
  const { error } = await supabase
    .from('workout_partners')
    .update({ status })
    .eq('id', inviteId);

  if (error) throw error;
}

export async function cancelInvite(inviteId: string) {
  const { error } = await supabase
    .from('workout_partners')
    .delete()
    .eq('id', inviteId);

  if (error) throw error;
}

export async function getPartnerStats(partnerId: string) {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1));
  // Safari-safe date handling
  startOfWeek.setHours(0);
  startOfWeek.setMinutes(0);
  startOfWeek.setSeconds(0);
  startOfWeek.setMilliseconds(0);

  // Get partner's basic info
  const { data: partnerData, error: partnerError } = await supabase
    .from('users')
    .select('id, name, username')
    .eq('id', partnerId) 
    .single();

  if (partnerError) throw partnerError;
  if (!partnerData) throw new Error('Partner not found');

  // Get partnership status
  const { data: partnershipData } = await supabase
    .from('workout_partners')
    .select('is_favorite')
    .eq('partner_id', partnerId)
    .eq('status', 'accepted')
    .single();

  // Get their workouts for current week
  const { data: workouts, error: workoutsError } = await supabase
    .from('daily_workouts')
    .select(`
      id,
      completed,
      workout_exercises!inner(
        id,
        target_sets,
        exercise_sets!inner(
          weight,
          completed
        )
      )
    `)
    .eq('user_id', partnerId)
    .gte('date', startOfWeek.toISOString())
    .lte('date', today.toISOString());

  if (workoutsError) throw workoutsError;

  // Calculate total weight lifted
  const totalWeight = workouts?.reduce((sum, workout) => {
    return sum + (workout.workout_exercises?.reduce((exSum, ex) => {
      return exSum + (ex.exercise_sets?.reduce((setSum, set) => 
        setSum + (set.completed ? (set.weight || 0) : 0), 0) || 0);
    }, 0) || 0);
  }, 0) || 0;

  // Calculate completion rate
  const totalWorkouts = workouts?.length || 0;
  const completedWorkouts = workouts?.filter(w => w.completed).length || 0;
  const completionRate = totalWorkouts > 0 
    ? Math.round((completedWorkouts / totalWorkouts) * 100)
    : 0;

  // Calculate weekly progress
  const weeklyProgress = workouts?.map(workout => {
    const totalSets = workout.workout_exercises?.reduce((total, ex) => 
      total + (ex.target_sets || 0), 0) || 0;
    const completedSets = workout.workout_exercises?.reduce((total, ex) => 
      total + (ex.exercise_sets?.filter(set => set.completed)?.length || 0), 0) || 0;
    return totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;
  }) || [];

  // Get current user's workouts for comparison
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: userWorkouts } = await supabase
    .from('daily_workouts')
    .select('*, workout_exercises!inner(id, target_sets, exercise_sets(weight, completed))')
    .eq('user_id', user.id)
    .gte('date', startOfWeek.toISOString())
    .lte('date', today.toISOString());

  // Calculate user's weekly progress
  const userProgress = userWorkouts?.map(workout => {
    const totalSets = workout.workout_exercises?.reduce((total, ex) => 
      total + (ex.target_sets || 0), 0) || 0;
    const completedSets = workout.workout_exercises?.reduce((total, ex) => 
      total + (ex.exercise_sets?.filter(set => set.completed)?.length || 0), 0) || 0;
    return totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;
  }) || [];

  return {
    name: partnerData.name,
    username: partnerData.username,
    isFavorite: partnershipData?.is_favorite || false,
    weeklyWorkouts: totalWorkouts,
    completedWorkouts,
    totalWeight,
    completionRate,
    weeklyProgress,
    streak: calculateStreak(workouts),
    userProgress
  };
}

export async function toggleFavoritePartner(partnerId: string, isFavorite: boolean) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('workout_partners')
    .update({ is_favorite: isFavorite })
    .eq('user_id', user.id)
    .eq('partner_id', partnerId)
    .eq('status', 'accepted');

  if (error) throw error;
}

function calculateStreak(workouts: any[]): number {
  if (!workouts?.length) return 0;
  
  let streak = 0;
  const sortedWorkouts = workouts
    .sort((a, b) => {
      // Safari-safe date parsing
      const dateA = new Date(a.date.replace(/-/g, '/'));
      const dateB = new Date(b.date.replace(/-/g, '/'));
      return dateB.getTime() - dateA.getTime();
    });
  
  for (const workout of sortedWorkouts) {
    // Safari-safe date parsing
    const workoutDate = new Date(workout.date.replace(/-/g, '/'));
    if (workout.completed) {
      streak++;
    } else {
      break;
    }
  }
  
  return streak;
}